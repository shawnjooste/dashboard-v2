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
  PageHeader,
  PrimaryLink,
  Card,
  CardHeader,
  StatusPill,
  type Health,
} from "@/components/ui";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        subtitle="Need a hand? Raise a ticket and a real person from our team will help you out."
        action={<PrimaryLink href="/support/new">+ Raise a ticket</PrimaryLink>}
      />

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
              className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-canvas"
            >
              <StatusPill tone={STATUS_TONE[t.status] ?? "warn"} label={STATUS_LABEL[t.status] ?? t.status} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{t.subject}</div>
                <div className="truncate text-xs text-muted">
                  #{t.number}
                  {scope.isManager && t.customerEmail !== scope.email ? ` · ${t.customerEmail}` : ""}
                  {t.preview ? ` · ${t.preview}` : ""}
                </div>
              </div>
              <span className="ml-auto shrink-0 text-xs text-faint">{t.updatedAt.slice(0, 10)}</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
