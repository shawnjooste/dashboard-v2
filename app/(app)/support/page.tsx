import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getSupportScope,
  listConversationsByEmail,
  listRecentConversations,
  type TicketSummary,
} from "@/lib/freescout";
import { filterConversations } from "@/lib/freescout-scope";
import {
  PrimaryLink,
  Card,
  CardHeader,
  StatusPill,
  type Health,
} from "@/components/ui";
import { SupportPageHeader } from "@/components/SupportPageHeader";
import { SupportEscalation } from "@/components/SupportEscalation";
import { getClientBookings } from "@/lib/views/bookings";
import { fmtRands } from "@/lib/booking-helpers";

const STATUS_LABEL: Record<string, string> = {
  active: "Open",
  pending: "Pending",
  closed: "Closed",
};

const STATUS_TONE: Record<string, Health> = {
  active: "warn",
  pending: "bad",
  closed: "good",
};

export default async function SupportPage() {
  const scope = await getSupportScope();
  if (!scope) redirect("/login");

  let tickets: TicketSummary[] = [];
  let unavailable = false;
  try {
    const own = await listConversationsByEmail(scope.email);
    let combined = own;
    if (scope.isManager && scope.clientDomains.length > 0) {
      const recent = await listRecentConversations();
      combined = [...own, ...recent];
    }
    tickets = filterConversations(combined, scope.email, scope.clientDomains).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  } catch {
    unavailable = true;
  }

  // Availability is fetched by the pages that actually offer booking
  // (/support/new and a ticket) — this page just lists what exists.
  const bookings = await getClientBookings();

  // Volume drives the upsell wording, nothing else — there are no caps.
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const ticketsThisMonth = tickets.filter((t) => t.updatedAt.startsWith(monthPrefix)).length;

  return (
    <div className="space-y-6">
      <SupportPageHeader
        ticketsThisMonth={ticketsThisMonth}
        action={<PrimaryLink href="/support/new">+ Raise a ticket</PrimaryLink>}
      />

      <SupportEscalation />

      {bookings.length > 0 && (
        <Card>
          <CardHeader title="Your bookings" count={bookings.length} />
          {bookings.map((b) => (
            <Link
              key={b.id}
              href={`/support/bookings/${b.id}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-canvas"
            >
              <StatusPill
                tone={b.status === "paid" || b.status === "completed" ? "good" : b.status === "cancelled" ? "bad" : "warn"}
                label={b.status === "pending_payment" ? "Awaiting payment" : b.status[0].toUpperCase() + b.status.slice(1)}
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">
                  {b.serviceName} — {b.slotLabel}
                </div>
                <div className="truncate text-xs text-muted">{fmtRands(b.amountCents + b.vatCents)} incl VAT</div>
              </div>
            </Link>
          ))}
        </Card>
      )}

      {unavailable ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            Our support area is taking a quick break — please try again in a few minutes.
          </p>
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            You haven&apos;t raised any tickets yet. Whenever something&apos;s not working, let us know.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Your tickets" count={tickets.length} />
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/support/${t.id}`}
              className="group flex flex-col gap-1.5 border-b border-line-soft px-4 py-3.5 last:border-0 hover:bg-canvas md:flex-row md:items-center md:gap-3 md:py-3"
            >
              <div className="flex items-center gap-2.5">
                <StatusPill tone={STATUS_TONE[t.status] ?? "warn"} label={STATUS_LABEL[t.status] ?? t.status} />
                <span className="text-xs text-faint md:hidden">{t.updatedAt.slice(0, 10)}</span>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-ink md:truncate">{t.subject}</div>
                <div className="truncate text-xs text-muted">
                  #{t.number}
                  {scope.isManager && t.customerEmail !== scope.email ? ` · ${t.customerEmail}` : ""}
                  {t.preview ? ` · ${t.preview}` : ""}
                </div>
              </div>
              <span className="ml-auto hidden shrink-0 text-xs text-faint md:inline">{t.updatedAt.slice(0, 10)}</span>
              {t.status !== "closed" && (
                <span className="shrink-0 self-start rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors md:self-auto md:group-hover:border-brand md:group-hover:bg-brand-tint md:group-hover:text-brand">
                  Book support
                </span>
              )}
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
