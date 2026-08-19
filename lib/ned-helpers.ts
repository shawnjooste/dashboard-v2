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
