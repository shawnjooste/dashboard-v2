import { redirect } from "next/navigation";
import { getConversation, getSupportScope } from "@/lib/freescout";
import { canAccessConversation, htmlToText } from "@/lib/freescout-scope";
import { ReplyForm } from "./ReplyForm";
import { BookSession } from "@/components/BookSession";
import { getActiveServices, getOpenSlotsByService } from "@/lib/views/bookings";
import { getSupportStatus } from "@/lib/views/support-packages";
import { getCurrentProfile } from "@/lib/auth/profile";
import {
  PageHeader,
  SecondaryLink,
  Card,
  CardHeader,
  StatusBadge,
  Avatar,
  type Health,
} from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await getSupportScope();
  if (!scope) redirect("/login");

  const ticketId = Number(id);
  let ticket = null;
  let unavailable = false;
  try {
    ticket = Number.isFinite(ticketId) ? await getConversation(ticketId) : null;
  } catch {
    unavailable = true;
  }

  const me = await getCurrentProfile();
  const services = await getActiveServices();
  const [slotsByService, supportStatus] = await Promise.all([
    getOpenSlotsByService(services),
    me.authenticated && me.profile.client_id ? getSupportStatus(me.profile.client_id) : null,
  ]);
  const covered = !!supportStatus?.pkg && !supportStatus.pkg.isDefault;

  if (unavailable) {
    return (
      <div className="space-y-6">
        <SecondaryLink href="/support">← Back to support</SecondaryLink>
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            Our support area is taking a quick break — please try again shortly.
          </p>
        </Card>
      </div>
    );
  }

  if (!ticket || !canAccessConversation(ticket.customerEmail, scope.email, scope.clientDomains)) {
    return (
      <div className="space-y-6">
        <SecondaryLink href="/support">← Back to support</SecondaryLink>
        <Card>
          <p className="px-4 py-6 text-sm text-muted">We couldn&apos;t find that ticket.</p>
        </Card>
      </div>
    );
  }

  const closed = ticket.status === "closed";
  const statusTone: Health = closed ? "good" : "warn";

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <SecondaryLink href="/support">← Back to support</SecondaryLink>
        }
        title={ticket.subject}
        subtitle={<StatusBadge tone={statusTone} label={closed ? "Closed" : "Open"} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_340px]">
        <div className="space-y-4">
          {ticket.threads.map((t) => {
            const isStaff = t.type !== "customer";
            return (
              <Card key={t.id}>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line-soft px-4 py-[11px]">
                  <Avatar name={t.authorName} tone={isStaff ? "dark" : "neutral"} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-ink">{t.authorName}</div>
                    <div className="text-[11.5px] text-muted">{isStaff ? "Support team" : "You"}</div>
                  </div>
                  <span className="ml-auto shrink-0 text-xs text-faint">
                    {fmtDateTime(t.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-line break-words px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
                  {htmlToText(t.body)}
                </p>
              </Card>
            );
          })}

          <ReplyForm ticketId={ticket.id} closed={closed} />
        </div>

        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line-soft">
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-[12.5px] text-muted">Ticket</dt>
                <dd className="text-[13px] font-medium text-ink">#{ticket.id}</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <dt className="text-[12.5px] text-muted">Status</dt>
                <dd>
                  <StatusBadge tone={statusTone} label={closed ? "Closed" : "Open"} />
                </dd>
              </div>
              {scope.isManager && ticket.customerEmail !== scope.email && (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt className="text-[12.5px] text-muted">Raised by</dt>
                  <dd className="truncate text-[13px] font-medium text-ink">{ticket.customerEmail}</dd>
                </div>
              )}
            </dl>
          </Card>

          <div id="book">
            <Card>
              <CardHeader title="Need hands-on help?" />
              <p className="border-b border-line-soft px-4 pb-3 pt-3.5 text-[13px] text-muted">
                Book a session for this ticket — it stays on this conversation.
              </p>
              <BookSession
                compact
                services={services}
                slotsByService={slotsByService}
                ticketNumber={ticket.id}
                covered={covered}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
