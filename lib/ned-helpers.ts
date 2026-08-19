/**
 * Pure helpers for the NED network-watch page (/admin/ned).
 * Import-free (CLAUDE.md rule 2) — no supabase, no react.
 *
 * The storm-watch loop (NED Claude session on Shawn's Mac) writes one row per
 * hourly capture; `status` in the row is authoritative. The one thing derived
 * here is STALENESS: the loop has no heartbeat, so an old row must not render
 * as a confident current verdict (same trap CLAUDE.md documents for the
 * onboarding cron — "a quiet day and a broken cron look the same").
 */

/** Loop cadence is hourly; three missed captures = the watch is stale. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type StormVerdict =
  | { kind: "status"; status: string }
  | { kind: "stale"; hoursAgo: number };

/**
 * What the verdict banner should show: the stored status while fresh, or a
 * neutral "stale" state once the newest capture is older than STALE_AFTER_MS.
 */
export function stormVerdict(capturedAtIso: string, status: string, nowMs: number): StormVerdict {
  const t = Date.parse(capturedAtIso);
  if (!Number.isFinite(t)) return { kind: "stale", hoursAgo: 0 };
  const age = nowMs - t;
  if (age > STALE_AFTER_MS) {
    return { kind: "stale", hoursAgo: Math.floor(age / (60 * 60 * 1000)) };
  }
  return { kind: "status", status };
}

/** GWF router's share of all ARP frames, whole percent; null when unmeasurable. */
export function gwfShare(arpFromGwf: number, arpFrames: number): number | null {
  if (arpFrames <= 0) return null;
  return Math.round((arpFromGwf / arpFrames) * 100);
}

/** Combined router health cell: both up → Up/good, any down → Down/bad, else Unknown/warn. */
export function routerCell(
  bgp1: string,
  steenberg: string,
): { value: string; tone: "good" | "bad" | "warn" } {
  const up = bgp1 === "up" && steenberg === "up";
  const down = bgp1 === "down" || steenberg === "down";
  return { value: up ? "Up" : down ? "Down" : "Unknown", tone: up ? "good" : down ? "bad" : "warn" };
}

/* ------------------------------------------------------------------ */
/* Deep-dive `details` jsonb (migration 0094)                          */
/* ------------------------------------------------------------------ */

/**
 * Shape the NED loop writes into ned_storm_watch.details. EVERY key is
 * optional — old rows have details = null, and the loop may omit any sub-key.
 * The page must render whatever subset is present and never crash on gaps,
 * so every leaf is `| null | undefined` and consumers go through the safe
 * getters below.
 */
export type NedRouterSnap = {
  status?: string | null;
  /** Uptime in seconds. */
  uptime?: number | null;
  last_polled?: string | null;
};

export type NedDetails = {
  capture?: {
    ended_utc?: string | null;
    pcap_bytes?: number | null;
    snaplen?: number | null;
    interface?: string | null;
    host?: string | null;
  } | null;
  rates?: {
    fps_avg?: number | null;
    fps_peak_5s?: number | null;
    bytes_total?: number | null;
    bps_avg?: number | null;
    gwf_arp_per_sec?: number | null;
    non_gwf_arp_per_sec?: number | null;
  } | null;
  protocols?: ({ name?: string | null; frames?: number | null } | null)[] | null;
  arp?: {
    requests?: number | null;
    replies?: number | null;
    from_gwf?: number | null;
    from_others?: number | null;
    distinct_targets_22?: number | null;
    distinct_targets_all?: number | null;
    retry_ratio?: number | null;
    top_senders?: ({ mac?: string | null; ip?: string | null; count?: number | null } | null)[] | null;
    top_targets?: ({ ip?: string | null; count?: number | null } | null)[] | null;
    target_subnets?: ({ subnet?: string | null; count?: number | null } | null)[] | null;
  } | null;
  tcp?: {
    retrans?: number | null;
    dup_ack?: number | null;
    resets?: number | null;
    zero_window?: number | null;
    out_of_order?: number | null;
  } | null;
  l2?: {
    unique_macs?: number | null;
    broadcast_frames?: number | null;
    multicast_frames?: number | null;
    stp_bpdus?: number | null;
    stp_root?: string | null;
    mndp_frames?: number | null;
  } | null;
  issues?: {
    dup_ip_10_0_0_1_macs?: (string | null)[] | null;
    arps_for_192_168_5_1?: number | null;
    icmp_errors?: number | null;
    dns_errors?: number | null;
    dhcp_discovers?: number | null;
  } | null;
  top_talkers?: ({
    ip?: string | null;
    tx_bytes?: number | null;
    rx_bytes?: number | null;
    total_bytes?: number | null;
  } | null)[] | null;
  librenms?: {
    bgp1?: NedRouterSnap | null;
    steenberg?: NedRouterSnap | null;
    active_alerts?: ({
      device_id?: number | string | null;
      rule_id?: number | string | null;
      rule?: string | null;
      since?: string | null;
    } | null)[] | null;
  } | null;
};

/**
 * Narrow the jsonb column to NedDetails: any plain object is accepted (the
 * type only promises optional keys), everything else — null, arrays,
 * scalars — comes back null so the page skips the deep-dive region entirely.
 */
export function parseNedDetails(v: unknown): NedDetails | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as NedDetails;
}

/** Finite number or null — jsonb leaves can be anything at runtime. */
export function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Non-empty string or null. */
export function safeStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Array (fresh copy, safe to sort) or []. The parameter is typed from
 * NedDetails but the runtime check still guards against malformed jsonb
 * smuggled through the cast.
 */
export function asList<T>(v: readonly T[] | null | undefined): T[] {
  return Array.isArray(v) ? [...v] : [];
}

/** "512 B" / "1.5 KB" / "42.0 MB" — em-dash for missing or negative values. */
export function fmtBytes(v: unknown): string {
  const n = safeNum(v);
  if (n == null || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = n / 1024;
  let i = 0;
  while (x >= 1000 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x >= 100 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}

/** Uptime seconds → "3d 5h" / "7h" / "<1h" — em-dash for missing/negative. */
export function fmtUptime(v: unknown): string {
  const s = safeNum(v);
  if (s == null || s < 0) return "—";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h`;
  return "<1h";
}
