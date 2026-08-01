/** Pure ticket→client mapping — no server imports (vitest-safe).
 *  Tickets live in FreeScout and only carry the customer's email, so the
 *  client is inferred from the email domain via client_domains. */

export type DomainRow = { client_id: string; domain: string };

/** The client that owns an email address, by exact domain match.
 *  Null when the domain isn't registered to anyone (personal addresses,
 *  prospects, one-off senders) — the caller should ask rather than guess. */
export function clientIdForEmail(email: string | null, domains: DomainRow[]): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  return domains.find((d) => d.domain.toLowerCase().trim() === domain)?.client_id ?? null;
}

/** Sum of logged minutes per FreeScout ticket number. */
export function minutesByTicket(entries: { freescout_number: number | null; minutes: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of entries) {
    if (e.freescout_number == null) continue;
    m.set(e.freescout_number, (m.get(e.freescout_number) ?? 0) + e.minutes);
  }
  return m;
}
