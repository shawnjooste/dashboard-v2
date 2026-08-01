import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listRecentConversations } from "@/lib/freescout";
import { clientIdForEmail, minutesByTicket, type DomainRow } from "@/lib/ticket-client-map";
import { buildNudges, nudgeHtml, ticketsNeedingTime, type NudgeTicket } from "@/lib/time-nudge";
import { sendJobDigest } from "@/lib/job-emails";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

/**
 * Weekly "log your time" nudge for Rocking staff.
 *
 * The hours model — client meters, per-ticket totals, Care allowances — is
 * only as honest as the ledger, and the ledger only fills if the team logs.
 * This lists tickets that moved in the last week with nothing logged against
 * them. A clean week sends no email at all.
 *
 * Service-role on purpose (a scheduled run has no signed-in user), guarded by
 * the same CRON_SECRET bearer as the jobs digest, and exported as GET and POST
 * so the scheduled and manual paths can't diverge.
 *
 * `?dry=1` returns what would be sent without sending — used to verify the
 * wording before it lands in anyone's inbox.
 */
async function runNudge(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not set — refusing to run the time nudge");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const service = createServiceClient();
  let tickets;
  try {
    tickets = await listRecentConversations();
  } catch (e) {
    console.error("time nudge: helpdesk unreachable", e);
    return NextResponse.json({ error: "helpdesk unreachable" }, { status: 502 });
  }

  const [{ data: domains }, { data: clients }, { data: entries }, { data: staff }] = await Promise.all([
    service.from("client_domains").select("client_id, domain"),
    service.from("clients").select("id, name"),
    service.from("support_time_entries").select("freescout_number, minutes"),
    service.from("profiles").select("email").eq("role", "rocking_staff").eq("status", "active"),
  ]);

  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const mins = minutesByTicket(entries ?? []);
  const rows: NudgeTicket[] = tickets.map((t) => {
    const clientId = clientIdForEmail(t.customerEmail, (domains ?? []) as DomainRow[]);
    return {
      id: t.id,
      subject: t.subject,
      clientName: clientId ? (nameById.get(clientId) ?? null) : null,
      updatedAt: t.updatedAt,
      loggedMinutes: mins.get(t.id) ?? 0,
    };
  });

  const outstanding = ticketsNeedingTime(rows, new Date());
  const recipients = (staff ?? []).map((s) => s.email);
  const nudges = buildNudges(recipients, outstanding);

  if (dry) {
    return NextResponse.json({
      dryRun: true,
      outstanding: outstanding.length,
      recipients,
      subject: nudges[0]?.subject ?? null,
      tickets: outstanding.slice(0, 20).map((t) => ({ id: t.id, subject: t.subject, client: t.clientName })),
    });
  }

  let sent = 0;
  for (const n of nudges) {
    try {
      await sendJobDigest(n.email, n.subject, nudgeHtml(n.tickets, APP_URL));
      sent++;
    } catch (e) {
      console.error("time nudge failed for", n.email, e);
    }
  }
  return NextResponse.json({ outstanding: outstanding.length, recipients: nudges.length, sent });
}

export const GET = runNudge;
export const POST = runNudge;
