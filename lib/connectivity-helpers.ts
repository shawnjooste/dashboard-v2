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
