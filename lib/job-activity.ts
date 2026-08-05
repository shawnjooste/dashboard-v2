// Pure helpers for the job activity trail. No Supabase import — safe from both
// server and client components.
//
// job_updates carries two audiences in one table. These helpers are the single
// place that decides which is which, so the "Client updates" panel can never
// silently start showing internal events.

/**
 * Kinds that represent something the CLIENT was actually told.
 *
 * Only `update` qualifies: it is written by the "Post update" form, which is the
 * one and only client-facing job email. Opening and completing a job deliberately
 * send nothing, so they belong in the internal Activity trail rather than in the
 * panel that documents client communication.
 */
export const CLIENT_UPDATE_KINDS = ["update"] as const;

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
