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
