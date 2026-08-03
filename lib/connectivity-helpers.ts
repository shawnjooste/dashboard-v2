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

export const HOP_KINDS = [
  "internet",
  "core",
  "distribution",
  "wireless",
  "tower",
  "cpe",
  "site",
  "other",
] as const;

export const HOP_KIND_LABELS: Record<string, string> = {
  internet: "Internet",
  core: "Core router",
  distribution: "Distribution",
  wireless: "Wireless link",
  tower: "Tower",
  cpe: "Router / CPE",
  site: "Your site",
  other: "Hop",
};

/** Glyph per hop type — plain text so it renders identically everywhere. */
export const HOP_KIND_ICONS: Record<string, string> = {
  internet: "☁",
  core: "◈",
  distribution: "◆",
  wireless: "((·))",
  tower: "▲",
  cpe: "▣",
  site: "⌂",
  other: "●",
};

export type PathHopStatus = { up: boolean | null; monitored: boolean };

/** How a connector between two hops should read: a break is only meaningful
 *  when we actually know the next hop is down. Unmonitored hops never imply
 *  a fault — they're labels, not measurements. */
export function connectorBroken(next: PathHopStatus): boolean {
  return next.monitored && next.up === false;
}

/** The first hop that is known-down, i.e. where the path breaks. Null when
 *  everything monitored is up (or nothing is monitored). */
export function firstBreakIndex(hops: PathHopStatus[]): number | null {
  const i = hops.findIndex((h) => h.monitored && h.up === false);
  return i === -1 ? null : i;
}

export type LinkState = "up" | "degraded" | "down" | "stale" | "unknown";

/** What to *show* for a link, combining LibreNMS's up/down with what the ping
 *  actually measured. 100% loss is down no matter what the poller's cached
 *  status says — "Online · 100% packet loss" is a contradiction, not a status.
 *  Partial loss is its own state: up, but visibly unhealthy. */
export function linkState(
  input: { up: boolean | null; lossPct: number | null; lastCheckedAt: string | null },
  nowMs: number,
): LinkState {
  if (isStale(input.lastCheckedAt, nowMs)) return "stale";
  if (input.up === false) return "down";
  if (input.lossPct != null && input.lossPct >= 100) return "down";
  if (input.up === true) {
    return input.lossPct != null && input.lossPct > 0 ? "degraded" : "up";
  }
  return "unknown";
}

export type HopState = "up" | "down" | "idle";

export type HopLike = {
  label: string;
  librenmsDeviceId: number | null;
  lastUp: boolean | null;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  /** True when this hop hangs off the same upstream as the one before it —
   *  a redundant leg of the same step, not the next step along. */
  parallelWithPrevious?: boolean;
};

/** A hop we don't monitor, or haven't heard from recently, is "idle" — drawn
 *  neutral. It is never evidence of a fault. */
export function hopStateOf(hop: HopLike, nowMs: number): HopState {
  if (hop.librenmsDeviceId == null) return "idle";
  if (isStale(hop.lastCheckedAt, nowMs)) return "idle";
  if (hop.lastUp === true) return "up";
  if (hop.lastUp === false) return "down";
  return "idle";
}

export const HOP_STATUS_WORD: Record<HopState, string> = {
  up: "OPERATIONAL",
  down: "DOWN",
  idle: "NO DATA",
};

/** Split a flat hop list into steps. Hops flagged parallel join the step
 *  before them, so one step can hold several devices sharing an upstream. The
 *  first hop always starts a step — there is nothing before it to be parallel
 *  with, whatever the flag says. */
export function groupHops<T extends { parallelWithPrevious?: boolean }>(hops: T[]): T[][] {
  const steps: T[][] = [];
  for (const hop of hops) {
    if (steps.length === 0 || !hop.parallelWithPrevious) steps.push([hop]);
    else steps[steps.length - 1].push(hop);
  }
  return steps;
}

export type GroupState = "up" | "degraded" | "down" | "idle";

/** A step passes if *any* of its legs answers — that is the whole point of
 *  running two. "degraded" is the honest middle: still passing, but a leg
 *  short, which is a warning rather than an outage. */
export function groupStateOf(states: HopState[]): GroupState {
  const up = states.some((s) => s === "up");
  const down = states.some((s) => s === "down");
  if (up && down) return "degraded";
  if (up) return "up";
  if (down) return "down";
  return "idle";
}

export type PathSummary = {
  /** Index of the first *step* that lost every leg — where the path breaks.
   *  Indexes groupHops(hops), not the flat hop list. */
  faultIndex: number | null;
  faultLabel: string | null;
  /** When the fault step was last heard from, for "stopped responding N ago". */
  faultSince: string | null;
  /** Legs lost in steps that still pass on another leg — worth saying, but
   *  not an outage. */
  degradedLabels: string[];
  /** True when every step before the fault is confirmed up. */
  upstreamPassing: boolean;
  /** Round trip to the final hop: genuinely end-to-end from our network to
   *  them. Deliberately NOT a sum of per-hop figures — those are each measured
   *  from the same probe, so adding them would invent a number. Null when the
   *  path ends in parallel legs: there is no single "end" to measure to. */
  e2eLatencyMs: number | null;
  allOperational: boolean;
};

export function pathSummary(hops: HopLike[], nowMs: number): PathSummary {
  const steps = groupHops(hops).map((legs) => ({ legs, states: legs.map((l) => hopStateOf(l, nowMs)) }));
  const stepStates = steps.map((s) => groupStateOf(s.states));

  const faultIndex = stepStates.findIndex((s) => s === "down");
  const fault = faultIndex === -1 ? null : steps[faultIndex];
  const faultSince = fault
    ? fault.legs.map((l) => l.lastCheckedAt).filter((t): t is string => t != null).sort().at(-1) ?? null
    : null;

  const degradedLabels = steps.flatMap((step, i) =>
    stepStates[i] === "degraded" ? step.legs.filter((_, j) => step.states[j] === "down").map((l) => l.label) : [],
  );

  const last = steps[steps.length - 1];
  return {
    faultIndex: faultIndex === -1 ? null : faultIndex,
    faultLabel: fault ? fault.legs.map((l) => l.label).join(" + ") : null,
    faultSince,
    degradedLabels,
    upstreamPassing: faultIndex <= 0 ? false : stepStates.slice(0, faultIndex).every((s) => s === "up"),
    // One leg's RTT is not the path's; only an unambiguous final hop qualifies.
    e2eLatencyMs: last && last.legs.length === 1 && last.states[0] === "up" ? last.legs[0].latencyMs : null,
    allOperational: hops.length > 0 && steps.every((s) => s.states.every((x) => x === "up")),
  };
}
