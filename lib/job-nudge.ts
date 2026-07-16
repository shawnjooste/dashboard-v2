/** Pure "does this job need a nudge?" rule — no server imports (vitest-safe). */

const STALE_DAYS = 7;

/** Returns the panel tag + sort rank for a job that's sitting, or null when
 *  it's flowing. Waiting jobs always surface (rank 0, tagged with their
 *  waiting note); other open jobs surface once untouched for 7+ days (rank 1,
 *  "stale Nd"). Done/cancelled never surface. */
export function jobNudge(
  status: string,
  waitingNote: string | null,
  updatedAt: string,
  now: Date,
): { tag: string; rank: number } | null {
  if (status === "waiting") return { tag: waitingNote?.trim() || "waiting", rank: 0 };
  if (status !== "todo" && status !== "in_progress") return null;
  const days = Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days < STALE_DAYS) return null;
  return { tag: `stale ${days}d`, rank: 1 };
}
