// Pure helpers for the job activity trail. No Supabase import — safe from both
// server and client components.
//
// job_updates carries two audiences in one table. These helpers are the single
// place that decides which is which, so the "Client updates" panel can never
// silently start showing internal events.

/** Kinds that represent something the CLIENT was actually told. */
export const CLIENT_UPDATE_KINDS = ["opened", "update", "completed"] as const;

/**
 * Whether a job_updates row belongs in the client-facing panel. Unknown kinds
 * are treated as internal on purpose: a future kind added to the constraint
 * should never leak into the client panel just because nobody updated this list.
 */
export function isClientUpdate(kind: string): boolean {
  return (CLIENT_UPDATE_KINDS as readonly string[]).includes(kind);
}

const LABELS: Record<string, string> = {
  opened: "Opened",
  update: "Update sent",
  completed: "Completed",
  status: "Status changed",
  assigned: "Task assigned",
};

/** Human label for an activity row; falls back to the raw kind. */
export function activityLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}
