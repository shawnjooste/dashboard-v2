/** Pure free-tier upsell logic — no server imports (vitest-safe).
 *
 *  No hard caps, ever (Shawn, 2026-07-21): email keeps working regardless, so
 *  a cap would only push traffic out of the portal, and it punishes people
 *  mid-crisis. Instead, volume is a *sales* signal — the client's own page
 *  sharpens its pitch, and heavy free users surface as leads. */

/** Tickets in a calendar month past which a free client is worth a call. */
export const HEAVY_USER_THRESHOLD = 5;

/** Is this free client using enough support to be worth a conversation? */
export function isHeavyFreeUser(ticketsThisMonth: number): boolean {
  return ticketsThisMonth >= HEAVY_USER_THRESHOLD;
}

/** The upsell line on a free client's support page. Sharpens once they're
 *  clearly relying on us, but never scolds — they're doing nothing wrong. */
export function upsellLine(ticketsThisMonth: number): string {
  return isHeavyFreeUser(ticketsThisMonth)
    ? `You've raised ${ticketsThisMonth} tickets this month. Business Care gives you guaranteed response times and included support hours — worth a chat?`
    : "We respond as capacity allows. Need guaranteed response times or included hours? Ask us about Business Care.";
}

export type HeavyUser = { clientName: string; tickets: number };

/** Free clients over the threshold, busiest first — the monthly lead list. */
export function heavyFreeUsers(
  rows: { clientName: string | null; onPaidTier: boolean; tickets: number }[],
): HeavyUser[] {
  return rows
    .filter((r) => r.clientName && !r.onPaidTier && isHeavyFreeUser(r.tickets))
    .map((r) => ({ clientName: r.clientName as string, tickets: r.tickets }))
    .sort((a, b) => b.tickets - a.tickets);
}
