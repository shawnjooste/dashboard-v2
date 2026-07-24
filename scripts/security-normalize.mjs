// Normalizes already-ingested telemetry into security_events (MDR data plane).
// Runs AFTER the nightly pulls: launchd com.rocking.security-normalize @ 03:00.
//   node scripts/security-normalize.mjs          # all clients
// Idempotent: unique (client_id, source_ref); re-runs add nothing new.
// Activity rows are insert-if-absent (immutable); posture rows keep their
// first-observed occurred_at, get re-opened if the weakness returns, and are
// resolved when a sync no longer sees them. triage_state is NEVER written here.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  mapDattoAlert, mapDattoAvPosture, mapDattoPatchPosture,
  mapM365AccountDisabled, mapM365Identity, mapM365SecurityDefaults,
  mapNetworkDown, postureToResolve,
  refDattoAlert, refDattoAv, refDattoPatch,
  refM365Disabled, refM365Mfa, refM365SecDefaults, refNetworkDown,
} from "../lib/security/severity-map.mjs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = new Date().toISOString();
const counts = { activity: 0, postureOpen: 0, postureResolved: 0 };
const activityRows = [];
const postureRows = [];

// ---------- Datto: alerts (activity) + AV/patch (posture) ----------
const { data: devices, error: devErr } = await sb
  .from("devices")
  .select("id, client_id, datto_uid, hostname, av_ok");
if (devErr) throw devErr;
const devById = new Map(devices.map((d) => [d.id, d]));

const { data: alerts, error: alertErr } = await sb
  .from("device_alerts")
  .select("device_id, triggered_at, message, priority, resolved, alert_policy");
if (alertErr) throw alertErr;
for (const a of alerts ?? []) {
  const d = devById.get(a.device_id);
  if (!d) continue;
  const m = mapDattoAlert(a.priority);
  activityRows.push({
    client_id: d.client_id, kind: "activity", source: "datto",
    category: m.category, severity: m.severity,
    entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
    title: a.message.slice(0, 200), detail: a.alert_policy,
    context: { resolved_in_source: a.resolved },
    occurred_at: a.triggered_at,
    source_ref: refDattoAlert(d.datto_uid, a.triggered_at, a.message),
  });
}

for (const d of devices) {
  if (d.av_ok === false) {
    const m = mapDattoAvPosture();
    postureRows.push({
      client_id: d.client_id, kind: "posture", source: "datto",
      category: m.category, severity: m.severity,
      entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
      title: `Antivirus not running on ${d.hostname}`,
      occurred_at: now, source_ref: refDattoAv(d.datto_uid),
    });
  }
}
const { data: patch, error: patchErr } = await sb
  .from("device_patch_status")
  .select("device_id, patch_status");
if (patchErr) throw patchErr;
for (const p of patch ?? []) {
  const d = devById.get(p.device_id);
  const m = d && mapDattoPatchPosture(p.patch_status);
  if (!d || !m) continue;
  postureRows.push({
    client_id: d.client_id, kind: "posture", source: "datto",
    category: m.category, severity: m.severity,
    entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
    title: `Patching problem on ${d.hostname}: ${p.patch_status}`,
    occurred_at: now, source_ref: refDattoPatch(d.datto_uid),
  });
}

// ---------- M365: identity posture + tenant config + disabled accounts ----------
const { data: m365, error: m365Err } = await sb
  .from("m365_users")
  .select("client_id, m365_user_id, display_name, user_principal_name, account_enabled, is_licensed, mfa_methods, mfa_strong");
if (m365Err) throw m365Err;
for (const u of m365 ?? []) {
  if (u.is_licensed && u.account_enabled && !u.mfa_strong) {
    const m = mapM365Identity(u.mfa_methods ?? []);
    postureRows.push({
      client_id: u.client_id, kind: "posture", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "user", entity_id: u.m365_user_id,
      entity_label: u.display_name ?? u.user_principal_name,
      title:
        (u.mfa_methods ?? []).length === 0
          ? `${u.display_name ?? u.user_principal_name} signs in with password only`
          : `${u.display_name ?? u.user_principal_name} has no strong MFA method`,
      context: { mfa_methods: u.mfa_methods },
      occurred_at: now, source_ref: refM365Mfa(u.m365_user_id),
    });
  }
  // Disabled licensed account: one-time activity row (dedup by user). First
  // run emits currently-disabled accounts once; re-disable after re-enable
  // will NOT re-emit (v1 limitation — needs state history we don't keep yet).
  if (u.is_licensed && u.account_enabled === false) {
    const m = mapM365AccountDisabled();
    activityRows.push({
      client_id: u.client_id, kind: "activity", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "user", entity_id: u.m365_user_id,
      entity_label: u.display_name ?? u.user_principal_name,
      title: `Account disabled: ${u.display_name ?? u.user_principal_name}`,
      occurred_at: now, source_ref: refM365Disabled(u.m365_user_id),
    });
  }
}
const { data: tenants, error: tenErr } = await sb
  .from("m365_tenant")
  .select("client_id, security_defaults_on, ca_policy_count");
if (tenErr) throw tenErr;
for (const t of tenants ?? []) {
  if (t.security_defaults_on === false && (t.ca_policy_count ?? 0) === 0) {
    const m = mapM365SecurityDefaults();
    postureRows.push({
      client_id: t.client_id, kind: "posture", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "tenant", entity_id: t.client_id, entity_label: "Microsoft 365 tenant",
      title: "Security defaults off with no conditional access policies",
      occurred_at: now, source_ref: refM365SecDefaults(t.client_id),
    });
  }
}

// ---------- Network: down/alerting devices (activity) ----------
const { data: net, error: netErr } = await sb
  .from("network_devices")
  .select("client_id, source_device_id, name, kind, status, last_seen_at");
if (netErr) throw netErr;
for (const n of net ?? []) {
  const m = mapNetworkDown(n.status);
  if (!m) continue;
  activityRows.push({
    client_id: n.client_id, kind: "activity", source: "network",
    category: m.category, severity: m.severity,
    entity_type: "site_device", entity_id: n.source_device_id,
    entity_label: n.name ?? n.source_device_id,
    title: `${n.name ?? "Network device"} is ${n.status}`,
    context: { kind: n.kind, last_seen_at: n.last_seen_at },
    occurred_at: n.last_seen_at ?? now, source_ref: refNetworkDown(n.source_device_id),
  });
}

// ---------- Write: activity insert-if-absent ----------
const CHUNK = 500;
for (let i = 0; i < activityRows.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .upsert(activityRows.slice(i, i + CHUNK), { onConflict: "client_id,source_ref", ignoreDuplicates: true });
  if (error) throw error;
}
counts.activity = activityRows.length;

// Pass 1: insert new posture rows only (ignoreDuplicates keeps the original
// occurred_at = first-observed on existing rows, and never touches triage).
for (let i = 0; i < postureRows.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .upsert(postureRows.slice(i, i + CHUNK), { onConflict: "client_id,source_ref", ignoreDuplicates: true });
  if (error) throw error;
}
// Pass 2: re-open previously-resolved rows whose weakness is back. Severity
// of long-open rows is NOT refreshed on mapping changes (accepted v1 cut —
// takes effect on resolve/re-open).
const currentByClient = new Map();
for (const r of postureRows) {
  if (!currentByClient.has(r.client_id)) currentByClient.set(r.client_id, []);
  currentByClient.get(r.client_id).push(r.source_ref);
}
for (const [clientId, refs] of currentByClient) {
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { error } = await sb
      .from("security_events")
      .update({ resolved: false, resolved_at: null, updated_at: now })
      .eq("client_id", clientId)
      .eq("resolved", true)
      .in("source_ref", refs.slice(i, i + CHUNK));
    if (error) throw error;
  }
}
counts.postureOpen = postureRows.length;

// ---------- Resolve posture rows whose weakness vanished from source ----------
const { data: openPosture, error: openErr } = await sb
  .from("security_events")
  .select("id, client_id, source_ref")
  .eq("kind", "posture")
  .eq("resolved", false);
if (openErr) throw openErr;
const currentRefs = postureRows.map((r) => `${r.client_id}|${r.source_ref}`);
const toResolve = new Set(
  postureToResolve(
    (openPosture ?? []).map((r) => `${r.client_id}|${r.source_ref}`),
    currentRefs,
  ),
);
const resolveIds = (openPosture ?? [])
  .filter((r) => toResolve.has(`${r.client_id}|${r.source_ref}`))
  .map((r) => r.id);
for (let i = 0; i < resolveIds.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .update({ resolved: true, resolved_at: now, updated_at: now })
    .in("id", resolveIds.slice(i, i + CHUNK));
  if (error) throw error;
}
counts.postureResolved = resolveIds.length;

await sb.from("import_runs").insert({
  source: "security-normalize",
  report_date: now.slice(0, 10),
  counts,
});
console.log("Security normalize complete:", JSON.stringify(counts, null, 1));
