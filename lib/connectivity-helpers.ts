/** Pure connectivity logic — no server imports (vitest-safe). */

export const KIND_LABELS: Record<string, string> = {
  fibre: "Fibre",
  wireless: "Fixed wireless",
  lte: "LTE",
  other: "Link",
};

/** "100/50 Mbps" | "100 Mbps" | null. */
export function speedLabel(down: number | null, up: number | null): string | null {
  if (down == null && up == null) return null;
  if (down != null && up != null) return `${down}/${up} Mbps`;
  return `${down ?? up} Mbps`;
}

export type LineStatus = { up: boolean | null; downSince: string | null };

/** LibreNMS /devices/:id payload → LineStatus. status 1/true=up, 0/false=down;
 *  downtime (seconds) → downSince. Anything malformed → unknown, never throws. */
export function mapLibrenmsDevice(d: unknown, nowMs: number): LineStatus {
  if (!d || typeof d !== "object") return { up: null, downSince: null };
  const rec = d as Record<string, unknown>;
  const s = rec.status;
  if (s === 1 || s === true || s === "1") return { up: true, downSince: null };
  if (s === 0 || s === false || s === "0") {
    const dt = typeof rec.downtime === "number" ? rec.downtime : Number(rec.downtime);
    return {
      up: false,
      downSince: Number.isFinite(dt) && dt > 0 ? new Date(nowMs - dt * 1000).toISOString() : null,
    };
  }
  return { up: null, downSince: null };
}

export const CONN_TYPES = ["pppoe", "static", "dhcp"] as const;

export const CONN_TYPE_LABELS: Record<string, string> = {
  pppoe: "PPPoE",
  static: "Static IP",
  dhcp: "Automatic (DHCP)",
};

export type IcmpSample = { up: boolean | null; latencyMs: number | null; lossPct: number | null };

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Latency only counts when it's a real measurement — a down device reports 0. */
const posOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
};

/** LibreNMS device payload → up/down (its authoritative signal) plus latency
 *  when the deployment actually provides it.
 *
 *  Deliberately does NOT read `last_ping_timetaken`: that field is how long the
 *  poller took to run, not the round-trip time — reading it as latency reports
 *  0.2 ms for a link that really sits at 53 ms. True RTT lives in RRD behind
 *  rrdcached and isn't exposed by the API, so the pull measures it directly
 *  with `ping` (see parsePing) and only falls back to LibreNMS's `ping_avg`
 *  where a deployment populates it. Never throws. */
export function mapIcmp(device: unknown): IcmpSample {
  if (!device || typeof device !== "object") return { up: null, latencyMs: null, lossPct: null };
  const rec = device as Record<string, unknown>;
  const s = rec.status;
  const up = s === 1 || s === true || s === "1" ? true : s === 0 || s === false || s === "0" ? false : null;
  if (up === null) return { up: null, latencyMs: null, lossPct: null };
  return { up, latencyMs: posOrNull(rec.ping_avg), lossPct: numOrNull(rec.ping_loss) };
}

/** The hostname/IP LibreNMS knows a device by, so the pull can ping it. */
export function deviceHost(device: unknown): string | null {
  if (!device || typeof device !== "object") return null;
  const h = (device as Record<string, unknown>).hostname;
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

/** Parse `ping -c N` output (BSD or Linux) into real RTT and loss. */
export function parsePing(stdout: string): { latencyMs: number | null; lossPct: number | null } {
  const loss = stdout.match(/([\d.]+)%\s*packet loss/);
  const avg = stdout.match(/=\s*[\d.]+\/([\d.]+)\//);
  return {
    latencyMs: avg ? posOrNull(avg[1]) : null,
    lossPct: loss ? numOrNull(loss[1]) : null,
  };
}

/** Outage start: stamped on the first down poll, held while down, cleared on
 *  recovery, untouched when the poll itself failed (up === null). */
export function nextDownSince(prevDownSince: string | null, up: boolean | null, nowIso: string): string | null {
  if (up === null) return prevDownSince;
  if (up) return null;
  return prevDownSince ?? nowIso;
}

/** True when we have no check, or the newest is older than 20 minutes. */
export function isStale(lastCheckedAt: string | null, nowMs: number): boolean {
  if (!lastCheckedAt) return true;
  return nowMs - Date.parse(lastCheckedAt) > 20 * 60 * 1000;
}
