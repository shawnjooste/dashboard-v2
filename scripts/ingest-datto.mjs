// One-off / repeatable Datto ingestion. Parses a Datto "Scheduled Report" export
// folder and upserts current-state device data + a dated health snapshot through
// the idempotent schema. Safe to re-run (all writes are upserts keyed on the
// schema's unique constraints). This is the seed of the future Plan 3 CLI.
//
// Usage:
//   node scripts/ingest-datto.mjs <path-to-report-folder> [report-date YYYY-MM-DD]
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
// (service role — bypasses RLS, as ingestion must).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

// ---- env -------------------------------------------------------------------
function loadEnv() {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const dir = process.argv[2];
const reportDate = process.argv[3] || "2026-05-22";
if (!dir) {
  console.error("Usage: node scripts/ingest-datto.mjs <report-folder> [YYYY-MM-DD]");
  process.exit(1);
}

// ---- helpers ---------------------------------------------------------------
const readCsv = (name) =>
  parse(readFileSync(join(dir, name), "utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const JUNK_SERIALS = new Set([
  "", "Default string", "System Serial Number", "To be filled by O.E.M.",
  "Not Specified", "None", "Not Available",
]);
const cleanSerial = (s) => {
  const v = (s ?? "").trim();
  return JUNK_SERIALS.has(v) ? null : v;
};
// "2026-05-22 11:24:23 CAT" / "2026-05-07 14:52" -> ISO with +02:00 (CAT)
const ts = (s) => {
  let v = (s ?? "").replace(/\s*CAT\s*$/, "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) v += ":00";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return v.replace(" ", "T") + "+02:00";
  return null;
};
const normalizeAv = (raw) => {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("not running")) return false;
  if (v.includes("running")) return true;
  return null;
};

// ---- parse files -----------------------------------------------------------
const details = readCsv("DeviceDetailsExport.csv");
const storage = readCsv("DeviceStorageExport.csv");
const patch = readCsv("DevicePatchSummaryExport.csv");
const alerts = readCsv("MonitorAlertsExport.csv");

const detailsByHost = new Map();
for (const r of details) detailsByHost.set(r["Device Hostname"], r);

// storage: group drive rows + capture device meta (first row per host)
const storageByHost = new Map(); // host -> { meta, drives: [] }
for (const r of storage) {
  const host = r["Device Hostname"];
  if (!storageByHost.has(host)) {
    storageByHost.set(host, {
      meta: {
        description: r["Device Description"] || null,
        serial: cleanSerial(r["Serial Number"]),
        model: r["Device Model"] || null,
        manufacturer: r["Manufacturer"] || null,
        site: r["Site Name"] || null,
      },
      drives: [],
    });
  }
  storageByHost.get(host).drives.push(r);
}

const patchByHost = new Map();
for (const r of patch) patchByHost.set(r["Device Hostname"], r);

const alertsByHost = new Map();
for (const r of alerts) {
  const host = r["Device Hostname"];
  if (!alertsByHost.has(host)) alertsByHost.set(host, []);
  alertsByHost.get(host).push(r);
}

// site for a host (storage > patch > alerts)
const siteForHost = (host) =>
  storageByHost.get(host)?.meta.site ||
  patchByHost.get(host)?.["Site Name"] ||
  alertsByHost.get(host)?.[0]?.["Site Name"] ||
  null;

const allHosts = new Set([
  ...detailsByHost.keys(),
  ...storageByHost.keys(),
  ...patchByHost.keys(),
]);

// ---- 1. clients + site_aliases --------------------------------------------
const siteNames = new Set();
for (const host of allHosts) {
  const s = siteForHost(host);
  if (s) siteNames.add(s);
}

async function ensureClientsAndAliases() {
  const siteToClient = new Map();
  const { data: existingClients } = await supabase.from("clients").select("id, name");
  const byName = new Map((existingClients ?? []).map((c) => [c.name, c.id]));

  for (const site of siteNames) {
    let clientId = byName.get(site);
    if (!clientId) {
      const { data, error } = await supabase
        .from("clients")
        .insert({ name: site })
        .select("id")
        .single();
      if (error) throw error;
      clientId = data.id;
      byName.set(site, clientId);
    }
    // upsert the site alias (site string -> client)
    await supabase
      .from("site_aliases")
      .upsert({ site_name: site, client_id: clientId }, { onConflict: "site_name" });
    siteToClient.set(site, clientId);
  }
  return siteToClient;
}

// ---- main ------------------------------------------------------------------
async function main() {
  const siteToClient = await ensureClientsAndAliases();

  const { data: run, error: runErr } = await supabase
    .from("import_runs")
    .insert({
      source: "datto",
      report_date: reportDate,
      file_names: [
        "DeviceDetailsExport.csv",
        "DeviceStorageExport.csv",
        "DevicePatchSummaryExport.csv",
        "MonitorAlertsExport.csv",
      ],
    })
    .select("id")
    .single();
  if (runErr) throw runErr;
  const runId = run.id;

  // ---- build device rows ----
  const deviceRows = [];
  const skipped = [];
  for (const host of allHosts) {
    const site = siteForHost(host);
    if (!site) {
      skipped.push(host);
      continue;
    }
    const clientId = siteToClient.get(site);
    const d = detailsByHost.get(host) ?? {};
    const sm = storageByHost.get(host)?.meta ?? {};
    const serial = sm.serial ?? null;
    deviceRows.push({
      client_id: clientId,
      device_identity: serial || host,
      hostname: host,
      serial_number: serial,
      assigned_user_label: sm.description ?? null,
      operating_system: d["Operating System"] || null,
      last_reboot: ts(d["Last Reboot"]),
      cpu: d["Device CPU"] || null,
      physical_cores: int(d["Physical CPU Cores"]),
      memory: d["Memory"] || null,
      av_status_raw: d["Security"] || null,
      av_ok: normalizeAv(d["Security"]),
      manufacturer: sm.manufacturer ?? null,
      model: sm.model ?? null,
      external_ip: d["Ext IP Addr"] || null,
      agent_version: d["Agent Version"] || null,
      enrollment_date: ts(d["Enrollment Date"]),
      last_import_run_id: runId,
    });
  }

  // ---- upsert devices, get ids ----
  const { data: upserted, error: devErr } = await supabase
    .from("devices")
    .upsert(deviceRows, { onConflict: "client_id,device_identity" })
    .select("id, hostname, client_id");
  if (devErr) throw devErr;
  const deviceIdByHost = new Map(upserted.map((r) => [r.hostname, r.id]));
  const clientIdByDevice = new Map(upserted.map((r) => [r.id, r.client_id]));

  // ---- device_storage: replace per device ----
  const deviceIds = [...deviceIdByHost.values()];
  await supabase.from("device_storage").delete().in("device_id", deviceIds);
  const storageRows = [];
  for (const [host, { drives }] of storageByHost) {
    const deviceId = deviceIdByHost.get(host);
    if (!deviceId) continue;
    for (const r of drives) {
      storageRows.push({
        device_id: deviceId,
        drive: r["Drive"],
        drive_type: r["Drive Type"] || null,
        size_gb: num(r["Size (GB)"]),
        free_gb: num(r["Free (GB)"]),
        used_gb: num(r["Used (GB)"]),
        free_pct: num(r["Free (%)"]),
        used_pct: num(r["Used (%)"]),
        import_run_id: runId,
      });
    }
  }
  if (storageRows.length)
    await supabase.from("device_storage").insert(storageRows);

  // ---- device_patch_status: upsert by device_id ----
  const patchRows = [];
  for (const [host, r] of patchByHost) {
    const deviceId = deviceIdByHost.get(host);
    if (!deviceId) continue;
    patchRows.push({
      device_id: deviceId,
      patches_approved_pending: int(r["Patches Approved Pending"]),
      patches_installed: int(r["Patches Installed"]),
      patches_not_approved: int(r["Patches Not Approved"]),
      patch_status: r["Patch Status"] || null,
      last_reboot: ts(r["Last Reboot"]),
      import_run_id: runId,
    });
  }
  if (patchRows.length)
    await supabase
      .from("device_patch_status")
      .upsert(patchRows, { onConflict: "device_id" });

  // ---- device_alerts: insert, ignore duplicates ----
  const alertRows = [];
  for (const [host, list] of alertsByHost) {
    const deviceId = deviceIdByHost.get(host);
    if (!deviceId) continue;
    for (const r of list) {
      const triggered = ts(r["Alert Triggered"]);
      if (!triggered) continue;
      alertRows.push({
        device_id: deviceId,
        triggered_at: triggered,
        message: r["Alert Message"] ?? "",
        priority: r["Priority"] || null,
        resolved: (r["Alert Resolved"] || "").trim().toLowerCase() === "yes",
        resolved_at: ts(r["Alert Resolved Date"]),
        ticket_number: r["Ticket Number"] || null,
        alert_policy: r["Alert Policy"] || null,
        import_run_id: runId,
      });
    }
  }
  if (alertRows.length)
    await supabase
      .from("device_alerts")
      .upsert(alertRows, { onConflict: "device_id,triggered_at,message", ignoreDuplicates: true });

  // ---- device_health_snapshots: one per device for this report date ----
  const snapRows = [];
  for (const [host, deviceId] of deviceIdByHost) {
    const p = patchByHost.get(host);
    let patchPct = null;
    if (p) {
      const installed = int(p["Patches Installed"]) ?? 0;
      const pending = int(p["Patches Approved Pending"]) ?? 0;
      const denom = installed + pending;
      patchPct = denom > 0 ? Math.round((100 * installed) / denom) : 100;
    }
    let maxDisk = null;
    for (const r of storageByHost.get(host)?.drives ?? []) {
      const usedPct = num(r["Used (%)"]);
      const type = (r["Drive Type"] || "").toLowerCase();
      if (usedPct !== null && type.includes("local"))
        maxDisk = maxDisk === null ? usedPct : Math.max(maxDisk, usedPct);
    }
    const openAlerts = (alertsByHost.get(host) ?? []).filter(
      (r) => (r["Alert Resolved"] || "").trim().toLowerCase() !== "yes",
    ).length;
    snapRows.push({
      device_id: deviceId,
      client_id: clientIdByDevice.get(deviceId),
      snapshot_date: reportDate,
      patch_pct: patchPct,
      max_disk_pct: maxDisk,
      av_ok: normalizeAv(detailsByHost.get(host)?.["Security"]),
      open_alert_count: openAlerts,
      import_run_id: runId,
    });
  }
  if (snapRows.length)
    await supabase
      .from("device_health_snapshots")
      .upsert(snapRows, { onConflict: "device_id,snapshot_date" });

  // ---- update run counts ----
  const counts = {
    clients: siteToClient.size,
    devices: deviceRows.length,
    storage: storageRows.length,
    patch: patchRows.length,
    alerts: alertRows.length,
    snapshots: snapRows.length,
    skipped_no_site: skipped.length,
  };
  await supabase.from("import_runs").update({ counts }).eq("id", runId);

  console.log("Datto ingestion complete:", JSON.stringify(counts, null, 2));
  console.log("Clients:", [...siteToClient.keys()].join(", "));
  if (skipped.length)
    console.log("Skipped (no site mapping):", skipped.join(", "));
}

main().catch((e) => {
  console.error("INGESTION FAILED:", e.message ?? e);
  process.exit(1);
});
