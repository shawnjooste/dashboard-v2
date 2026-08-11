/** Which portal email a person may switch off — and who gets filtered out.
 *  Pure, no server imports (vitest-safe).
 *
 *  SAFETY: this is deliberately an allow-list. Everything else the portal
 *  sends is transactional — a quote, a booking, an agreement, a sign-in link
 *  — and must reach its recipient regardless of preferences. Only
 *  announcements ("portal_update") and the onboarding tour steps
 *  ("onboarding_step") are suppressible. `onboarding` — the welcome email,
 *  which carries the sign-in link — is deliberately absent. A category added
 *  later is deliverable unless someone deliberately adds it here, and that
 *  should take a good argument. */
export const SUPPRESSIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  "portal_update",
  "onboarding_step",
]);

export function isSuppressible(category: string | undefined): boolean {
  return category !== undefined && SUPPRESSIBLE_CATEGORIES.has(category);
}

/** Split a recipient list into who to send to and who opted out. `optedOut`
 *  holds lowercased addresses; comparison is case-insensitive. */
export function splitRecipients(
  to: string[],
  category: string | undefined,
  optedOut: Set<string>,
): { send: string[]; suppressed: string[] } {
  if (!isSuppressible(category) || optedOut.size === 0) return { send: [...to], suppressed: [] };
  const send: string[] = [];
  const suppressed: string[] = [];
  for (const address of to) {
    (optedOut.has(address.trim().toLowerCase()) ? suppressed : send).push(address);
  }
  return { send, suppressed };
}
