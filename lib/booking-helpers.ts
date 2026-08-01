/** Pure booking logic — no server imports (vitest-safe).
 *  All slot times are UTC ISO strings; SAST is a fixed UTC+2 (no DST). */

export const PENDING_HOLD_MINUTES = 30;
export const VAT_RATE = 0.15;
const SAST_OFFSET_H = 2;
const FIRST_HOUR_SAST = 8; // 08:00 first slot start
const LAST_HOUR_SAST = 16; // 16:00 last slot start (ends 17:00)

export type SlotBlocker = { slot_start: string; slot_end: string; status: string; created_at: string };

/** Is this booking still holding its time? Paid/completed always; pending only
 *  inside the hold window. Cancelled and lapsed-pending free it. */
function isLive(b: SlotBlocker, now: Date): boolean {
  if (b.status === "paid" || b.status === "completed") return true;
  if (b.status !== "pending_payment") return false;
  return now.getTime() - new Date(b.created_at).getTime() < PENDING_HOLD_MINUTES * 60_000;
}

/** True when [start, start+duration) overlaps a live booking. Services have
 *  different durations (30-min remote, 60-min onsite), so this compares
 *  intervals — matching start times alone would happily sell a half-hour
 *  slot in the middle of an hour-long one. */
export function slotTaken(
  slotStartIso: string,
  durationMinutes: number,
  blockers: SlotBlocker[],
  now: Date,
): boolean {
  const start = new Date(slotStartIso).getTime();
  const end = start + durationMinutes * 60_000;
  return blockers.some((b) => {
    if (!isLive(b, now)) return false;
    const bStart = new Date(b.slot_start).getTime();
    const bEnd = new Date(b.slot_end).getTime();
    return start < bEnd && bStart < end;
  });
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Open slots for the next N business days starting TOMORROW (SAST). The
 *  fallback grid is hourly regardless of duration; duration only decides what
 *  counts as a clash. */
export function openSlots(opts: {
  now: Date;
  businessDays: number;
  blockers: SlotBlocker[];
  durationMinutes?: number;
}): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  // Walk days in SAST by shifting the clock +2h and using UTC accessors.
  const cursor = new Date(opts.now.getTime() + SAST_OFFSET_H * 3_600_000);
  cursor.setUTCHours(0, 0, 0, 0);
  let daysFound = 0;
  while (daysFound < opts.businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    daysFound++;
    for (let h = FIRST_HOUR_SAST; h <= LAST_HOUR_SAST; h++) {
      const startUtcMs = cursor.getTime() + (h - SAST_OFFSET_H) * 3_600_000;
      const iso = new Date(startUtcMs).toISOString();
      if (slotTaken(iso, opts.durationMinutes ?? 60, opts.blockers, opts.now)) continue;
      out.push({
        iso,
        label: `${DAY[dow]} ${cursor.getUTCDate()} ${MON[cursor.getUTCMonth()]}, ${String(h).padStart(2, "0")}:00`,
      });
    }
  }
  return out;
}

export function vatCents(priceCents: number): number {
  return Math.round(priceCents * VAT_RATE);
}

export function totalCents(priceCents: number): number {
  return priceCents + vatCents(priceCents);
}

/** Admin triage buckets: paid+future = upcoming (soonest first); paid+past =
 *  needs attention ("did we actually do this job?"); everything else = recent
 *  history (newest slot first). */
export function groupBookings<T extends { slotStart: string; status: string }>(
  bookings: T[],
  now: Date,
): { upcoming: T[]; needsAttention: T[]; recent: T[] } {
  const upcoming: T[] = [];
  const needsAttention: T[] = [];
  const recent: T[] = [];
  for (const b of bookings) {
    if (b.status === "paid") {
      (new Date(b.slotStart) > now ? upcoming : needsAttention).push(b);
    } else {
      recent.push(b);
    }
  }
  upcoming.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  needsAttention.sort((a, b) => b.slotStart.localeCompare(a.slotStart));
  recent.sort((a, b) => b.slotStart.localeCompare(a.slotStart));
  return { upcoming, needsAttention, recent };
}

/** 115000 → "R 1 150,00" (space thousands, comma decimals — deterministic). */
export function fmtRands(cents: number): string {
  const [whole, dec] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R ${grouped},${dec}`;
}
