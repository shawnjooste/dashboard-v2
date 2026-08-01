/** Pure builder for the weekly "log your time" nudge — no server imports.
 *
 *  The whole hours model (client meters, per-ticket totals, Care allowances)
 *  is only as honest as the ledger, and the ledger only fills if the team
 *  logs. This turns "did anyone log time?" into a weekly, per-person list of
 *  tickets that moved but have nothing against them. */

export type NudgeTicket = {
  id: number;
  subject: string;
  clientName: string | null;
  updatedAt: string;
  loggedMinutes: number;
};

export type Nudge = { email: string; subject: string; tickets: NudgeTicket[] };

/** Tickets touched within the window that carry no logged time, newest first.
 *  Closed tickets count — work happened even if the thread is finished.
 *
 *  Tickets with no client are skipped deliberately: the helpdesk also receives
 *  backup reports, cron output and supplier invoices, none of which are client
 *  work, and a time entry needs a client to belong to. Chasing those would
 *  bury the real ones (86 outstanding on the first live run, nearly all
 *  robots) and teach everyone to ignore the email. */
export function ticketsNeedingTime(
  tickets: NudgeTicket[],
  now: Date,
  windowDays = 7,
): NudgeTicket[] {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  return tickets
    .filter(
      (t) => t.clientName !== null && t.loggedMinutes === 0 && new Date(t.updatedAt).getTime() >= cutoff,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One nudge per recipient. Everyone gets the same list — FreeScout
 *  assignment isn't mirrored in the portal, so we don't pretend to know whose
 *  ticket it is; the team sorts that out between them. Returns nothing when
 *  there's nothing to chase, so a clean week sends no email at all. */
export function buildNudges(recipients: string[], outstanding: NudgeTicket[]): Nudge[] {
  if (outstanding.length === 0) return [];
  const one = outstanding.length === 1;
  const subject = `${outstanding.length} ticket${one ? "" : "s"} need${one ? "s" : ""} time logged`;
  return recipients.map((email) => ({ email, subject, tickets: outstanding }));
}

/** Plain-English body. Kept here (not in the route) so the wording is testable. */
const MAX_LISTED = 25;

export function nudgeHtml(tickets: NudgeTicket[], portalUrl: string): string {
  const shown = tickets.slice(0, MAX_LISTED);
  const overflow = tickets.length - shown.length;
  const rows = shown
    .map(
      (t) =>
        `<li style="margin:0 0 6px;"><a href="${portalUrl}/admin/tickets/${t.id}">#${t.id} — ${t.subject}</a>` +
        `<span style="color:#666;"> · ${t.clientName ?? "unmatched client"} · updated ${t.updatedAt.slice(0, 10)}</span></li>`,
    )
    .join("");
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1a1a1a;">
      <h2 style="margin:0 0 8px;">Tickets with no time logged</h2>
      <p style="color:#444;margin:0 0 14px;">
        These moved in the last week but have nothing logged against them. Logging time keeps client
        hours honest — and it's what our retainer meters are built on.
      </p>
      <ul style="padding-left:18px;margin:0 0 16px;">${rows}</ul>
      ${overflow > 0 ? `<p style="color:#666;margin:0 0 16px;">…and ${overflow} more in the portal.</p>` : ""}
      <a href="${portalUrl}/admin/tickets" style="display:inline-block;background:#D7141C;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;">Open tickets</a>
    </div>`;
}
