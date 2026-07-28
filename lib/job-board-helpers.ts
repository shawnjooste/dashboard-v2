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

/** What a card was dropped on: another card, or a column's empty-space shell. */
export type BoardDropTarget = { kind: "card"; id: string } | { kind: "column" };

/**
 * Compute the index to pass to `placeCard` for a jobs-board drag-and-drop.
 *
 * `destinationIds` is the destination column's ids in their current order.
 * For a same-column move, the active card is already a member of that column
 * — include it in `destinationIds` at its current position. For a
 * cross-column move, the active card is not yet a member — exclude it.
 *
 * That inclusion convention is what makes a single formula correct for both
 * cases: dropping on a card inserts before that card's position in
 * `destinationIds`. For a same-column move this naturally lands the active
 * card AFTER a card it started below, and BEFORE one it started above —
 * matching dnd-kit's `arrayMove` preview under `verticalListSortingStrategy`
 * (the previous implementation used the without-active index unconditionally,
 * which is one slot too high for a downward same-column drop and also made
 * the bottom slot of the tallest column unreachable). For a cross-column move
 * it is the ordinary "insert before the hovered card" behaviour.
 *
 * Dropping on the column shell appends to the end of the column (after the
 * active card is removed from consideration, for a same-column move).
 */
export function boardDropIndex(
  destinationIds: string[],
  activeId: string,
  target: BoardDropTarget,
  sameColumn: boolean,
): number {
  const withoutActiveLength = sameColumn ? destinationIds.length - 1 : destinationIds.length;
  if (target.kind === "column") return withoutActiveLength;
  const at = destinationIds.findIndex((id) => id === target.id);
  return at < 0 ? withoutActiveLength : at;
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

/** The card shape `filterJobCards` needs. Structural, so it works on any row carrying these. */
export type FilterableCard = {
  clientId: string;
  ownerProfileId: string | null;
  assignees: { id: string }[];
};

/** Board filter selections. Blank strings mean "no filter". */
export type JobFilters = {
  client?: string;
  owner?: string;
  assignee?: string;
  /** When set, keep only jobs this profile owns or is assigned a task on. */
  mineProfileId?: string;
};

/** Apply the board filters. Filters combine with AND; blanks are ignored. */
export function filterJobCards<T extends FilterableCard>(cards: T[], filters: JobFilters): T[] {
  const { client, owner, assignee, mineProfileId } = filters;
  return cards.filter((c) => {
    if (client && c.clientId !== client) return false;
    if (owner && c.ownerProfileId !== owner) return false;
    if (assignee && !c.assignees.some((a) => a.id === assignee)) return false;
    if (mineProfileId && c.ownerProfileId !== mineProfileId && !c.assignees.some((a) => a.id === mineProfileId)) {
      return false;
    }
    return true;
  });
}

/** Sort comparator: soonest due first, undated last. */
export function compareByDue(a: { dueDate: string | null }, b: { dueDate: string | null }): number {
  if (a.dueDate === b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}
