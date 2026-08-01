import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAdminTicket } from "@/lib/views/admin-tickets";
import { htmlToText } from "@/lib/freescout-scope";
import { fmtMinutes } from "@/lib/support-package-helpers";
import {
  addNoteAction,
  deleteTicketTimeAction,
  logTicketTimeAction,
  replyToTicketAction,
  setTicketStatusAction,
} from "../actions";
import { Card, CardHeader, PageHeader, SecondaryLink, StatusBadge } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const WORK_TYPES = ["ticket", "remote", "onsite", "other"] as const;

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");
  const { id } = await params;
  const ticketId = Number(id);
  const data = Number.isFinite(ticketId) ? await getAdminTicket(ticketId) : null;

  if (!data) {
    return (
      <div className="space-y-6">
        <SecondaryLink href="/admin/tickets">← All tickets</SecondaryLink>
        <Card>
          <p className="px-4 py-6 text-sm text-muted">Ticket not found, or the helpdesk isn&apos;t reachable.</p>
        </Card>
      </div>
    );
  }

  const { ticket, clientId, clientName, loggedMinutes, entries, bookings, clients } = data;
  const closed = ticket.status === "closed";
  const reply = replyToTicketAction.bind(null, ticketId);
  const note = addNoteAction.bind(null, ticketId);
  const logTime = logTicketTimeAction.bind(null, ticketId);
  const toggle = setTicketStatusAction.bind(null, ticketId, closed ? "active" : "closed");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link href="/admin/tickets" className="hover:text-ink">← All tickets</Link>}
        title={ticket.subject}
        subtitle={`#${ticketId} · ${clientName ?? ticket.customerEmail ?? "unknown client"}`}
        action={
          <form action={toggle}>
            <button className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
              {closed ? "Reopen" : "Close ticket"}
            </button>
          </form>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Conversation" count={ticket.threads.length} />
            {ticket.threads.map((t) => (
              <div key={t.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <p className="text-xs text-faint">
                  {t.authorName} · {t.createdAt.slice(0, 16).replace("T", " ")}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{htmlToText(t.body)}</p>
              </div>
            ))}
          </Card>

          <Card>
            <CardHeader title="Reply to the client" />
            <form action={reply} className="space-y-2 px-4 py-3.5">
              <textarea
                name="message"
                required
                rows={4}
                placeholder="Your reply — the client sees this."
                className={`${FIELD} w-full`}
              />
              <button className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white hover:bg-brand-dark">
                Send reply
              </button>
            </form>
          </Card>

          <Card>
            <CardHeader title="Internal note" />
            <form action={note} className="space-y-2 px-4 py-3.5">
              <textarea
                name="note"
                required
                rows={2}
                placeholder="Only the team sees this."
                className={`${FIELD} w-full`}
              />
              <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black">
                Add note
              </button>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Time on this ticket" count={fmtMinutes(loggedMinutes)} />
            <form action={logTime} className="space-y-2 border-b border-line-soft px-4 py-3.5">
              <div className="flex flex-wrap gap-2">
                <input name="minutes" type="number" min="1" required placeholder="Mins" className={`${FIELD} w-20`} />
                <select name="work_type" defaultValue="ticket" className={FIELD}>
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
                <input name="occurred_on" type="date" className={FIELD} />
              </div>
              <select name="client_id" defaultValue={clientId ?? ""} required className={`${FIELD} w-full`}>
                <option value="" disabled>
                  Which client?
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input name="note" placeholder="What did you do?" className={`${FIELD} w-full`} />
              <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black">
                Log time
              </button>
              {!clientId && (
                <p className="text-xs text-warn-ink">
                  This ticket&apos;s email domain isn&apos;t mapped to a client — pick one so the hours land somewhere.
                </p>
              )}
            </form>
            {entries.length === 0 ? (
              <p className="px-4 py-3.5 text-sm text-muted">No time logged yet.</p>
            ) : (
              <ul>
                {entries.map((e) => {
                  const remove = deleteTicketTimeAction.bind(null, e.id, ticketId);
                  return (
                    <li key={e.id} className="flex items-start gap-2 border-b border-line-soft px-4 py-2.5 last:border-0">
                      <span className="w-14 shrink-0 text-right text-[13px] font-medium text-ink">
                        {fmtMinutes(e.minutes)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink-2">{e.note ?? e.workType}</p>
                        <p className="text-xs text-faint">
                          {e.occurredOn}
                          {e.author ? <span className="capitalize"> · {e.author}</span> : ""}
                        </p>
                      </div>
                      <form action={remove}>
                        <button className="text-xs text-faint hover:text-brand">Remove</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {bookings.length > 0 && (
            <Card>
              <CardHeader title="Sessions" count={bookings.length} />
              <ul>
                {bookings.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 last:border-0">
                    <StatusBadge
                      tone={b.status === "paid" || b.status === "completed" ? "good" : b.status === "cancelled" ? "bad" : "warn"}
                      label={b.status === "pending_payment" ? "Awaiting payment" : b.status}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                      {b.serviceName} — {b.slotLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
