// Network collector (Slice 1 pilot). Reads network_source_aliases, pulls each
// source-site from Meraki / UniFi, normalizes, and idempotently upserts
// network_sites / network_devices / network_health_snapshots under the mapped
// client. Run locally where the API keys live:  node scripts/network-pull.mjs
//
// Secrets: Meraki key ~/.config/meraki/api_key, UniFi self-hosted creds
// ~/.config/unifi/selfhosted.json — read at runtime, never printed/committed.
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import https from "https";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Meraki (TLS verified; manual redirect re-sends auth) ----------
const MERAKI_KEY = readFileSync(join(homedir(), ".config/meraki/api_key"), "utf8").trim();
async function meraki(path) {
  let url = `https://api.meraki.com/api/v1${path}`;
  const headers = { "X-Cisco-Meraki-API-Key": MERAKI_KEY, Authorization: `Bearer ${MERAKI_KEY}`, Accept: "application/json" };
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url).toString(); continue; }
    return res;
  }
  throw new Error("meraki: too many redirects");
}
function merakiKind(model = "") {
  if (/^MX|^MG|^Z/i.test(model)) return "gateway";
  if (/^MS/i.test(model)) return "switch";
  if (/^MR|^CW/i.test(model)) return "ap";
  return "other";
}
async function pullMeraki(sourceKey, label) {
  const [orgId, netId] = sourceKey.split("/");
  const net = await (await meraki(`/networks/${netId}`)).json();
  const devices = await (await meraki(`/networks/${netId}/devices`)).json();
  const statuses = await (await meraki(`/organizations/${orgId}/devices/statuses`)).json();
  const byserial = new Map(statuses.map((s) => [s.serial, s]));
  const out = devices.map((d) => {
    const st = byserial.get(d.serial) ?? {};
    const status = st.status === "dormant" ? "offline" : (st.status ?? null);
    return {
      source_device_id: d.serial, name: d.name || d.mac || d.serial, kind: merakiKind(d.model),
      model: d.model ?? null, ip: d.lanIp ?? st.publicIp ?? null, status, firmware: d.firmware ?? null,
      uptime_s: null, client_count: null, last_seen_at: st.lastReportedAt ?? null,
    };
  });
  return { siteName: net.name ?? label, devices: out, clientCount: null };
}

// ---------- UniFi self-hosted (insecure agent scoped to these calls) ----------
const UNIFI = JSON.parse(readFileSync(join(homedir(), ".config/unifi/selfhosted.json"), "utf8"));
const insecure = new https.Agent({ rejectUnauthorized: false });
function unifiReq(method, path, { cookie, body } = {}) {
  const u = new URL(UNIFI.host.replace(/\/$/, "") + path);
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, port: u.port || 8443, path: u.pathname + u.search, method, agent: insecure,
      headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { let j; try { j = JSON.parse(s); } catch { j = null; } resolve({ status: res.statusCode, headers: res.headers, json: j }); }); });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
let unifiCookie = null;
async function unifiLogin() {
  const r = await unifiReq("POST", "/api/login", { body: { username: UNIFI.username, password: UNIFI.password } });
  if (r.status !== 200) throw new Error(`unifi login ${r.status}`);
  unifiCookie = (r.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");
}
async function unifiGet(path) {
  if (!unifiCookie) await unifiLogin();
  let r = await unifiReq("GET", path, { cookie: unifiCookie });
  if (r.status === 401) { await unifiLogin(); r = await unifiReq("GET", path, { cookie: unifiCookie }); }
  return r.json?.data ?? [];
}
function unifiKind(type = "") {
  if (type === "usw") return "switch";
  if (type === "uap") return "ap";
  if (["ugw", "udm", "uxg", "uxg-pro"].includes(type)) return "gateway";
  return "other";
}
async function pullUnifi(siteId, label) {
  const sites = await unifiGet("/api/self/sites");
  const siteName = sites.find((s) => s.name === siteId)?.desc ?? label;
  const devs = await unifiGet(`/api/s/${siteId}/stat/device`);
  const sta = await unifiGet(`/api/s/${siteId}/stat/sta`);
  const out = devs.map((d) => ({
    source_device_id: d.mac, name: d.name || d.model || d.mac, kind: unifiKind(d.type),
    model: d.model ?? null, ip: d.ip ?? null, status: d.state === 1 ? "online" : "offline",
    firmware: d.version ?? null, uptime_s: d.uptime ?? null, client_count: d.num_sta ?? null,
    last_seen_at: d.last_seen ? new Date(d.last_seen * 1000).toISOString() : null,
  }));
  return { siteName, devices: out, clientCount: sta.length };
}

// ---------- idempotent upsert ----------
async function upsertReport(alias, report) {
  const devs = report.devices;
  const up = devs.filter((d) => d.status === "online").length;
  const down = devs.filter((d) => d.status === "offline").length;
  const alerting = devs.some((d) => d.status === "alerting");
  const status = up === 0 && devs.length ? "offline" : (down > 0 || alerting ? "degraded" : "online");
  const lastSeen = devs.map((d) => d.last_seen_at).filter(Boolean).sort().at(-1) ?? nowIso();

  const { data: run, error: runErr } = await sb.from("import_runs")
    .insert({ source: `network:${alias.source}`, report_date: today, counts: { devices: devs.length, up, down } }).select("id").single();
  if (runErr) throw runErr;

  const { data: site, error: siteErr } = await sb.from("network_sites").upsert({
    source: alias.source, source_site_id: alias.source_key, client_id: alias.client_id, name: report.siteName,
    status, device_count: devs.length, client_count: report.clientCount, last_seen_at: lastSeen,
    last_import_run_id: run.id, updated_at: nowIso(),
  }, { onConflict: "source,source_site_id" }).select("id").single();
  if (siteErr) throw siteErr;

  if (devs.length) {
    const rows = devs.map((d) => ({ ...d, source: alias.source, client_id: alias.client_id, site_id: site.id, last_import_run_id: run.id, updated_at: nowIso() }));
    const { error: devErr } = await sb.from("network_devices").upsert(rows, { onConflict: "source,source_device_id" });
    if (devErr) throw devErr;
  }

  const { error: snapErr } = await sb.from("network_health_snapshots").upsert({
    client_id: alias.client_id, site_id: site.id, snapshot_date: today,
    devices_total: devs.length, devices_up: up, devices_down: down, client_count: report.clientCount, status,
  }, { onConflict: "site_id,snapshot_date" });
  if (snapErr) throw snapErr;

  return { status, devices: devs.length, up, down, clients: report.clientCount };
}

// ---------- run ----------
const { data: aliases, error } = await sb.from("network_source_aliases").select("source, source_key, client_id, label");
if (error) { console.log("alias load failed:", error.message); process.exit(1); }
console.log(`Collecting ${aliases.length} source-site(s) for ${today}\n`);
for (const a of aliases) {
  try {
    const report = a.source === "meraki" ? await pullMeraki(a.source_key, a.label)
      : a.source === "unifi_selfhosted" ? await pullUnifi(a.source_key, a.label)
      : null;
    if (!report) { console.log(`! ${a.source} ${a.label}: no adapter, skipped`); continue; }
    const r = await upsertReport(a, report);
    console.log(`✓ ${a.source} "${report.siteName}" → ${r.status}  (${r.devices} dev, ${r.up} up/${r.down} down, ${r.clients ?? "—"} clients)`);
    await sleep(250);
  } catch (e) {
    console.log(`✗ ${a.source} ${a.label}: ${e.message}`);
  }
}
console.log("\ndone");
