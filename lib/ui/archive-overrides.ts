/** Pure merge of locally-applied archive/restore results over server rows.
 *
 *  Why this exists: the admin clients list is ~180 rows and the page is
 *  dynamically rendered, so driving the UI off a route revalidation meant
 *  re-fetching every device and person just to flip one row's status — a
 *  full-list re-render that threw away the reader's scroll position. The row
 *  is updated locally instead; the next fresh request re-reads the truth.
 */
export function applyArchived<T extends { id: string; archived: boolean }>(
  rows: T[],
  overrides: Record<string, boolean>,
): T[] {
  if (Object.keys(overrides).length === 0) return rows;
  return rows.map((r) => (r.id in overrides ? { ...r, archived: overrides[r.id] } : r));
}
