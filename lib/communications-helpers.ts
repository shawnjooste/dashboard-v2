/** Pure display helpers for the communications page — no server imports
 *  (vitest-safe). */

export const CATEGORY_LABELS: Record<string, string> = {
  onboarding: "Welcome",
  booking: "Booking",
  quote: "Quote",
  job: "Job update",
  admin_alert: "Internal",
  general: "General",
};

/** Friendly label for a category, falling back to the raw key so a new
 *  category added by a future sender still renders sensibly. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** "a@x.com, b@x.com, c@x.com +2 more" — keeps long recipient lists readable. */
export function formatRecipients(emails: string[]): string {
  if (emails.length === 0) return "—";
  if (emails.length <= 3) return emails.join(", ");
  return `${emails.slice(0, 3).join(", ")} +${emails.length - 3} more`;
}
