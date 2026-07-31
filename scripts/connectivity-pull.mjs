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
import { readFileSync } from "node:fs";
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

// LibreNMS is authoritative for up/down. It does NOT expose round-trip time:
// last_ping_timetaken is the poller's own runtime (0.4ms for a 53ms link), and
// the real RTT lives in RRD behind rrdcached. So we ping the host ourselves —
// same vantage point LibreNMS uses, since this runs on that box.
function mapIcmp(device) {
  if (!device || typeof device !== "object") return { up: null, latencyMs: null, lossPct: null };
  const s = device.status;
  const up = s === 1 || s === true || s === "1" ? true : s === 0 || s === false || s === "0" ? false : null;
  if (up === null) return { up: null, latencyMs: null, lossPct: null };
  return { up, latencyMs: posOrNull(device.ping_avg), lossPct: numOrNull(device.ping_loss) };
}

function deviceHost(device) {
  const h = device && typeof device === "object" ? device.hostname : null;
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

function parsePing(stdout) {
  const loss = stdout.match(/([\d.]+)%\s*packet loss/);
  const avg = stdout.match(/=\s*[\d.]+\/([\d.]+)\//);
  return { latencyMs: avg ? posOrNull(avg[1]) : null, lossPct: loss ? numOrNull(loss[1]) : null };
}

/** Measure real RTT + loss. Never throws — ping exits non-zero on 100% loss. */
async function measure(host) {
  try {
    const { stdout } = await run("ping", ["-c", "3", "-t", "5", host], { timeout: 15_000 });
    return parsePing(stdout);
  } catch (e) {
    return parsePing(e?.stdout ?? "");
  }
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
    sample = mapIcmp(device);
    // Fill in the numbers LibreNMS can't give us, from an actual ping.
    const host = deviceHost(device);
    if (sample.up !== null && host) {
      const m = await measure(host);
      sample = { up: sample.up, latencyMs: sample.latencyMs ?? m.latencyMs, lossPct: sample.lossPct ?? m.lossPct };
    }
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

console.log(`connectivity pull: ${ok} ok, ${failed} failed, ${lines.length} lines @ ${nowIso}`);
