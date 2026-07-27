// Pure helpers for the Jobs board. No Supabase import — safe to use from both
// server and client components.

export type DueState = "overdue" | "due_soon" | "none";

/** Cards due today or within this many days read as "due soon". */
const DUE_SOON_DAYS = 2;
const DAY_MS = 86_400_000;

/** Whole days from `a` to `b`, both YYYY-MM-DD. Timezone-independent. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** How a job's due date should read on its card, relative to `today`. */
export function dueState(dueDate: string | null, today: string): DueState {
  if (!dueDate) return "none";
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff <= DUE_SOON_DAYS) return "due_soon";
  return "none";
}

/**
 * Place `movedId` at `toIndex` within a column and renumber the whole column
 * 0..n-1. Works whether the card is arriving from another column or moving
 * within this one (it is removed first either way), and clamps out-of-range
 * indexes. Renumbering everything keeps positions gap-free.
 */
export function placeCard(
  orderedIds: string[],
  movedId: string,
  toIndex: number,
): { id: string; position: number }[] {
  const without = orderedIds.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(toIndex, without.length));
  const next = [...without.slice(0, at), movedId, ...without.slice(at)];
  return next.map((id, position) => ({ id, position }));
}

/** A Date as YYYY-MM-DD in the business timezone (en-CA formats as ISO). */
export function toDateString(d: Date, timeZone = "Africa/Johannesburg"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
