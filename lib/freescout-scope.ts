/** Pure authorization + rendering helpers for the FreeScout support surface. */

/** Email bodies arrive as HTML; render as plain text (no dangerouslySetInnerHTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const emailDomain = (email: string): string =>
  email.trim().toLowerCase().split("@")[1] ?? "";

/** May this caller see a conversation belonging to `customerEmail`? */
export function canAccessConversation(
  customerEmail: string | null | undefined,
  callerEmail: string,
  clientDomains: string[],
): boolean {
  if (!customerEmail) return false;
  const target = customerEmail.trim().toLowerCase();
  if (target === callerEmail.trim().toLowerCase()) return true;
  return clientDomains.some((d) => emailDomain(target) === d.trim().toLowerCase());
}

/** Filter + dedupe conversations (by id) down to what the caller may see. */
export function filterConversations<T extends { id: number; customerEmail: string | null }>(
  conversations: T[],
  callerEmail: string,
  clientDomains: string[],
): T[] {
  const seen = new Set<number>();
  return conversations.filter((c) => {
    if (seen.has(c.id)) return false;
    if (!canAccessConversation(c.customerEmail, callerEmail, clientDomains)) return false;
    seen.add(c.id);
    return true;
  });
}
