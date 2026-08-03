// Connectivity pull — runs ON VISION (the LibreNMS box) every 5 minutes.
// LibreNMS lives on the tailnet, so the portal can never poll it; this writes
// each mapped line's ICMP status into Supabase instead, and the portal reads
// what's stored.
//
// Config: a chmod-600 JSON file (default /etc/rocking/conn-pull.json):
//   {
//     "supabaseUrl": "https://eskhokedsximnslgsycs.supabase.co",
//     "serviceKey":  "<service_role key>",
//     "librenmsUrl": "http://localhost",
//     "librenmsKey": "<read-only API token>"
//   }
// Override the path with ROCKING_CONN_CONF. Run by hand to test:
//   ROCKING_CONN_CONF=./conn-pull.json node scripts/connectivity-pull.mjs
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

// --- mirrors of lib/connectivity-helpers.ts (the tested source of truth).
// Plain node can't import the .ts helper; keep these two in sync by hand.
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// Latency only counts when it's a real measurement — a down device reports 0.
const posOrNull = (v) => {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
};

function deviceHost(device) {
  const h = device && typeof device === "object" ? device.hostname : null;
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

function parsePing(stdout) {
  const loss = stdout.match(/([\d.]+)%\s*packet loss/);
  const avg = stdout.match(/=\s*[\d.]+\/([\d.]+)\//);
  return { latencyMs: avg ? posOrNull(avg[1]) : null, lossPct: loss ? numOrNull(loss[1]) : null };
}

// Absolute path on purpose: ping lives in /sbin on macOS, which is NOT on
// cron's PATH. Resolving it by name worked when run by hand and silently
// ENOENT'd under cron — every scheduled run then had no measurement at all.
const PING_BIN = ["/sbin/ping", "/bin/ping", "/usr/bin/ping"].find((p) => existsSync(p)) ?? null;

/** Measure real RTT + loss. Never throws — ping exits non-zero on 100% loss.
 *  `verdict` is true only when ping actually produced a loss figure; without
 *  one we have no evidence and must not guess. */
async function measure(host) {
  const none = { latencyMs: null, lossPct: null, verdict: false };
  if (!PING_BIN) return none;
  try {
    const { stdout } = await run(PING_BIN, ["-c", "3", "-t", "5", host], { timeout: 15_000 });
    const p = parsePing(stdout);
    return { ...p, verdict: p.lossPct != null };
  } catch (e) {
    const p = parsePing(String(e?.stdout ?? ""));
    return { ...p, verdict: p.lossPct != null };
  }
}

/** What we actually believe about a host.
 *
 *  The ping we run here is authoritative, NOT LibreNMS's status: LibreNMS
 *  polls from inside a colima container whose user-mode networking answers
 *  ICMP for *every* address — it reports 0% loss to reserved TEST-NET ranges
 *  that cannot exist, so its ping-only devices always read "up". If our own
 *  ping can't reach a verdict we record unknown rather than inheriting that
 *  false green. (Revisit if SNMP-polled devices are ever added: for those,
 *  LibreNMS is the better authority.) */
function verdictFrom(m) {
  if (!m.verdict) return { up: null, latencyMs: null, lossPct: null };
  const up = m.lossPct < 100;
  return { up, latencyMs: up ? m.latencyMs : null, lossPct: m.lossPct };
}

function nextDownSince(prevDownSince, up, nowIso) {
  if (up === null) return prevDownSince;
  if (up) return null;
  return prevDownSince ?? nowIso;
}
// --- end mirrors

const confPath = process.env.ROCKING_CONN_CONF ?? "/etc/rocking/conn-pull.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const H = {
  apikey: conf.serviceKey,
  Authorization: `Bearer ${conf.serviceKey}`,
  "Content-Type": "application/json",
};
const nowIso = new Date().toISOString();
if (!PING_BIN) console.error("WARNING: no ping binary found — every host will record as unknown");
const rest = (path, init) =>
  fetch(`${conf.supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });

const lines = await (
  await rest(
    "connectivity_services?is_active=eq.true&librenms_device_id=not.is.null&select=id,label,librenms_device_id,down_since",
  )
).json();

let ok = 0;
let failed = 0;

for (const line of lines) {
  let sample = { up: null, latencyMs: null, lossPct: null };
  try {
    const r = await fetch(`${conf.librenmsUrl.replace(/\/$/, "")}/api/v0/devices/${line.librenms_device_id}`, {
      headers: { "X-Auth-Token": conf.librenmsKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    const device = body?.devices?.[0] ?? null;
    const host = deviceHost(device);
    // Our ping decides up/down; LibreNMS only tells us which host to ping.
    sample = host ? verdictFrom(await measure(host)) : { up: null, latencyMs: null, lossPct: null };
  } catch (e) {
    failed++;
    console.error(`${line.label}: ${e.message}`);
  }

  // A failed poll bumps the timestamp only — it must never look like an outage.
  const patch =
    sample.up === null
      ? { last_checked_at: nowIso }
      : {
          last_up: sample.up,
          latency_ms: sample.latencyMs,
          loss_pct: sample.lossPct,
          last_checked_at: nowIso,
          down_since: nextDownSince(line.down_since, sample.up, nowIso),
        };
  await rest(`connectivity_services?id=eq.${line.id}`, { method: "PATCH", body: JSON.stringify(patch) });

  if (sample.up !== null) {
    await rest("connectivity_samples", {
      method: "POST",
      body: JSON.stringify({
        service_id: line.id,
        up: sample.up,
        latency_ms: sample.latencyMs,
        loss_pct: sample.lossPct,
      }),
    });
    ok++;
  }

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  await rest(`connectivity_samples?service_id=eq.${line.id}&at=lt.${cutoff}`, { method: "DELETE" });
}

// --- path hops: same treatment, so each step of the path has live status ---
const hops = await (
  await rest("connectivity_path_hops?librenms_device_id=not.is.null&select=id,label,librenms_device_id")
).json();

let hopOk = 0;
let hopFailed = 0;

for (const hop of hops) {
  let sample = { up: null, latencyMs: null, lossPct: null };
  try {
    const r = await fetch(`${conf.librenmsUrl.replace(/\/$/, "")}/api/v0/devices/${hop.librenms_device_id}`, {
      headers: { "X-Auth-Token": conf.librenmsKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    const device = body?.devices?.[0] ?? null;
    const host = deviceHost(device);
    sample = host ? verdictFrom(await measure(host)) : { up: null, latencyMs: null, lossPct: null };
  } catch (e) {
    hopFailed++;
    console.error(`hop ${hop.label}: ${e.message}`);
  }

  const patch =
    sample.up === null
      ? { last_checked_at: nowIso }
      : { last_up: sample.up, latency_ms: sample.latencyMs, last_checked_at: nowIso };
  await rest(`connectivity_path_hops?id=eq.${hop.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (sample.up !== null) hopOk++;
}

console.log(
  `connectivity pull: ${ok} ok, ${failed} failed, ${lines.length} lines | ${hopOk} ok, ${hopFailed} failed, ${hops.length} hops @ ${nowIso}`,
);
