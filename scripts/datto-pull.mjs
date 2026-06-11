// Canonical Datto RMM pull. Keys devices on Datto's stable `uid` (with a
// first-run hostname backfill for CSV-seeded rows). Idempotent.
//
//   node scripts/datto-pull.mjs

import { createClient } from "@supabase/supabase-js";
import { dattoEnv, getToken, dattoGet, dattoPaged, epochToIso } from "../lib/datto-rmm.mjs";

const SYSTEM_SITES = new Set(["Managed", "OnDemand", "Deleted Devices"]);
const reportDate = new Date().toISOString().slice(0, 10);

const env = dattoEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const token = await getToken(env);

// site name -> client_id
const { data: aliases } = await sb.from("site_aliases").select("site_name, client_id");
const clientBySite = new Map((aliases ?? []).map((a) => [a.site_name, a.client_id]));

// existing devices for reconciliation
const { data: existing } = await sb.from("devices").select("id, client_id, hostname, datto_uid");
const byUid = new Map();
const byClientHost = new Map();
for (const d of existing ?? []) {
  if (d.datto_uid) byUid.set(d.datto_uid, d);
  byClientHost.set(`${d.client_id}|${(d.hostname ?? "").toLowerCase()}`, d);
}

const { data: run } = await sb.from("import_runs")
  .insert({ source: "datto", report_date: reportDate, file_names: [] }).select("id").single();
const runId = run.id;
const counts = { devices: 0, storage: 0, patch: 0, alerts: 0, skippedSites: [], auditFails: 0 };

const sites = await dattoPaged(env, token, "/api/v2/account/sites", "sites");
const deviceRows = [];
const storageByUid = new Map();
const patchByUid = new Map();

for (const site of sites) {
  if (SYSTEM_SITES.has(site.name)) continue;
  const clientId = clientBySite.get(site.name);
  if (!clientId) { if (site.devicesStatus?.numberOfDevices) counts.skippedSites.push(site.name); continue; }

  const devices = await dattoPaged(env, token, `/api/v2/site/${site.uid}/devices`, "devices");
  for (const d of devices) {
    // Backfill datto_uid onto a CSV-seeded row matched by hostname.
    if (!byUid.has(d.uid)) {
      const match = byClientHost.get(`${clientId}|${(d.hostname ?? "").toLowerCase()}`);
      if (match && !match.datto_uid) {
        await sb.from("devices").update({ datto_uid: d.uid }).eq("id", match.id);
        match.datto_uid = d.uid;
        byUid.set(d.uid, match);
      }
    }

    // Hardware audit (serial, make/model, memory, disks). Best-effort.
    let audit = {};
    const a = await dattoGet(env, token, `/api/v2/audit/device/${d.uid}`);
    if (a.ok) audit = a.body; else counts.auditFails += 1;
    const sys = audit.systemInfo ?? {};
    const avStatus = d.antivirus?.antivirusStatus ?? null;

    deviceRows.push({
      client_id: clientId,
      datto_uid: d.uid,
      hostname: d.hostname ?? "(unknown)",
      serial_number: audit.baseBoard?.serialNumber ?? audit.bios?.serialNumber ?? null,
      assigned_user_label: d.description ?? null,
      operating_system: d.operatingSystem ?? null,
      last_reboot: epochToIso(d.lastReboot),
      cpu: audit.processors?.[0]?.name ?? audit.processors?.[0]?.description ?? null,
      physical_cores: sys.totalCpuCores ?? null,
      memory: sys.totalPhysicalMemory ? `${(sys.totalPhysicalMemory / 1024 ** 3).toFixed(1)} GB` : null,
      av_status_raw: avStatus,
      av_ok: avStatus ? avStatus.startsWith("Running") : null,
      manufacturer: sys.manufacturer ?? null,
      model: sys.model ?? null,
      external_ip: d.extIpAddress ?? null,
      agent_version: d.cagVersion ?? null,
      enrollment_date: epochToIso(d.creationDate),
      last_user: d.lastLoggedInUser ?? null,
      last_import_run_id: runId,
    });

    storageByUid.set(d.uid, (audit.logicalDisks ?? []).filter((x) => /local/i.test(x.description ?? "")));
    const pm = d.patchManagement ?? {};
    patchByUid.set(d.uid, {
      patches_approved_pending: pm.patchesApprovedPending ?? null,
      patches_installed: pm.patchesInstalled ?? null,
      patches_not_approved: pm.patchesNotApproved ?? null,
      patch_status: pm.patchStatus ?? null,
      last_reboot: epochToIso(d.lastReboot),
    });
  }
}

// Upsert devices on datto_uid; map uid -> id.
const { data: upserted, error: devErr } = await sb.from("devices")
  .upsert(deviceRows, { onConflict: "datto_uid" }).select("id, datto_uid, client_id");
if (devErr) throw devErr;
counts.devices = deviceRows.length;
const idByUid = new Map(upserted.map((r) => [r.datto_uid, r.id]));
const clientByDevice = new Map(upserted.map((r) => [r.id, r.client_id]));
const deviceIds = [...idByUid.values()];

// Storage: replace per device.
await sb.from("device_storage").delete().in("device_id", deviceIds);
const storageRows = [];
for (const [uid, disks] of storageByUid) {
  const deviceId = idByUid.get(uid);
  for (const x of disks) {
    const size = Number(x.size) || 0;
    const free = Number(x.freespace) || 0;
    storageRows.push({
      device_id: deviceId, drive: x.diskIdentifier ?? "?", drive_type: x.description ?? "Local Disk",
      size_gb: size ? size / 1e9 : null, free_gb: free ? free / 1e9 : null,
      used_gb: size ? (size - free) / 1e9 : null,
      free_pct: size ? (100 * free) / size : null, used_pct: size ? (100 * (size - free)) / size : null,
      import_run_id: runId,
    });
  }
}
if (storageRows.length) await sb.from("device_storage").insert(storageRows);
counts.storage = storageRows.length;

// Patch status: upsert by device_id.
const patchRows = [];
for (const [uid, p] of patchByUid) {
  const deviceId = idByUid.get(uid);
  if (deviceId) patchRows.push({ device_id: deviceId, ...p, import_run_id: runId });
}
if (patchRows.length) await sb.from("device_patch_status").upsert(patchRows, { onConflict: "device_id" });
counts.patch = patchRows.length;

// Open alerts -> device_alerts.
const openAlerts = await dattoPaged(env, token, "/api/v2/account/alerts/open", "alerts");
const alertRows = [];
for (const al of openAlerts) {
  const deviceId = idByUid.get(al.alertSourceInfo?.deviceUid);
  const triggered = epochToIso(al.timestamp);
  if (!deviceId || !triggered) continue;
  alertRows.push({
    device_id: deviceId, triggered_at: triggered,
    message: (al.alertMonitorInfo?.diagnostics || al.diagnostics || `${al.priority ?? ""} alert`).slice(0, 500),
    priority: al.priority ?? null, resolved: !!al.resolved,
    resolved_at: epochToIso(al.resolvedOn), ticket_number: al.ticketNumber || null,
    alert_policy: al.alertContext?.["@class"] ?? null, import_run_id: runId,
  });
}
if (alertRows.length)
  await sb.from("device_alerts").upsert(alertRows, { onConflict: "device_id,triggered_at,message", ignoreDuplicates: true });
counts.alerts = alertRows.length;

// Health snapshots.
const snapRows = [];
for (const [uid, deviceId] of idByUid) {
  const p = patchByUid.get(uid) ?? {};
  const installed = p.patches_installed ?? 0, pending = p.patches_approved_pending ?? 0;
  const patchPct = installed + pending > 0 ? Math.round((100 * installed) / (installed + pending)) : 100;
  let maxDisk = null;
  for (const x of storageByUid.get(uid) ?? []) {
    const size = Number(x.size) || 0, free = Number(x.freespace) || 0;
    if (size) { const used = (100 * (size - free)) / size; maxDisk = maxDisk === null ? used : Math.max(maxDisk, used); }
  }
  const dev = deviceRows.find((r) => r.datto_uid === uid);
  const openCount = alertRows.filter((a) => a.device_id === deviceId && !a.resolved).length;
  snapRows.push({
    device_id: deviceId, client_id: clientByDevice.get(deviceId), snapshot_date: reportDate,
    patch_pct: patchPct, max_disk_pct: maxDisk, av_ok: dev?.av_ok ?? null, open_alert_count: openCount,
    import_run_id: runId,
  });
}
if (snapRows.length) await sb.from("device_health_snapshots").upsert(snapRows, { onConflict: "device_id,snapshot_date" });

await sb.from("import_runs").update({ counts }).eq("id", runId);
console.log("Datto RMM pull complete:", JSON.stringify(counts, null, 1));
if (counts.skippedSites.length) console.log("Unmapped sites with devices:", counts.skippedSites.join(", "));
