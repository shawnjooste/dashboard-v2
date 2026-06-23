// Pure helpers for job checklist tasks (kept separate so they're testable
// without the Supabase client).

export type Positioned = { id: string; position: number };

/**
 * Move a task one step up or down its checklist. Returns the two position
 * updates needed to swap it with its ordered neighbour — `[moved, neighbour]` —
 * or null when there's no neighbour (already at the end) or the id is unknown.
 *
 * Swaps the stored `position` *values*, so it's safe even if positions aren't
 * contiguous (e.g. after deletes).
 */
export function reorderSwap(
  tasks: Positioned[],
  taskId: string,
  direction: "up" | "down",
): [Positioned, Positioned] | null {
  const ordered = [...tasks].sort((a, b) => a.position - b.position);
  const i = ordered.findIndex((t) => t.id === taskId);
  if (i === -1) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ordered.length) return null;
  const moved = ordered[i];
  const neighbour = ordered[j];
  return [
    { id: moved.id, position: neighbour.position },
    { id: neighbour.id, position: moved.position },
  ];
}
