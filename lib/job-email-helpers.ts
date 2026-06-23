// Pure helpers for job notification emails (kept separate from job-emails.ts so
// they're testable without pulling in the service-role Supabase client).

/** The person fields used to greet a manager by name. */
export type PersonName = { first_name: string | null; display_name: string | null } | null;

/**
 * First-name greeting for a manager: the structured first name, else the first
 * token of their display name, else a neutral fallback. Never returns "".
 */
export function greetingName(person: PersonName): string {
  const first = person?.first_name?.trim();
  if (first) return first;
  const display = person?.display_name?.trim();
  if (display) return display.split(/\s+/)[0];
  return "there";
}

/** Kind of person a task can be assigned to. */
export type AssigneeKind = "staff" | "client";

/**
 * Greeting name for a task assignee. Client managers have a Person row, so use
 * their first name. Staff rarely do, so derive a capitalised name from the
 * email local-part (e.g. "shawn@rocking.one" → "Shawn").
 */
export function assigneeGreetingName(opts: { kind: AssigneeKind; email: string; person: PersonName }): string {
  if (opts.kind === "client") return greetingName(opts.person);
  const local = opts.email.split("@")[0].replace(/[._]/g, " ").trim();
  if (!local) return "there";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Subject + inner HTML body (to be wrapped by the caller) for a task-assignment
 * email. Two tones: a direct internal note for staff, a softer client-facing one
 * for client managers — same task label, gentler framing.
 */
export function assignmentEmailContent(opts: {
  kind: AssigneeKind;
  name: string;
  jobTitle: string;
  taskLabel: string;
}): { subject: string; body: string } {
  const { kind, name, jobTitle, taskLabel } = opts;
  const task = `<p style="color:#111; margin:0; font-weight:600;">${taskLabel}</p>`;
  if (kind === "client") {
    return {
      subject: `An action for you — ${jobTitle}`,
      body: `
      <p style="color:#444; margin:0 0 12px;">Hi ${name},</p>
      <p style="color:#444; margin:0 0 12px;">There's an action for you on your job with Rocking (<strong>${jobTitle}</strong>):</p>
      ${task}`,
    };
  }
  return {
    subject: `Task assigned — ${jobTitle}`,
    body: `
      <p style="color:#444; margin:0 0 12px;">Hi ${name},</p>
      <p style="color:#444; margin:0 0 12px;">You've been assigned a task on <strong>${jobTitle}</strong>:</p>
      ${task}`,
  };
}
