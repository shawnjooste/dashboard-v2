/** Pure Calendly payload/label helpers — no server imports (vitest-safe). */

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 27 Jul, 08:00" in SAST (fixed UTC+2) for a stored UTC slot. */
export function slotLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

/** Calendly event_type_available_times → the portal's slot shape.
 *  Available only, ISO-normalized, deduped, ascending. */
export function normalizeCalendlySlots(
  collection: { start_time: string; status: string }[],
): { iso: string; label: string }[] {
  const isos = [
    ...new Set(
      collection
        .filter((s) => s.status === "available")
        .map((s) => new Date(s.start_time).toISOString()),
    ),
  ].sort();
  return isos.map((iso) => ({ iso, label: slotLabel(iso) }));
}

/** Split [start, endExclusive) into windows of at most maxDays. */
export function chunkWindows(
  start: Date,
  endExclusive: Date,
  maxDays: number,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = start.getTime();
  const endMs = endExclusive.getTime();
  const step = maxDays * 86_400_000;
  while (cursor < endMs) {
    const winEnd = Math.min(cursor + step, endMs);
    out.push({ start: new Date(cursor).toISOString(), end: new Date(winEnd).toISOString() });
    cursor = winEnd;
  }
  return out;
}
