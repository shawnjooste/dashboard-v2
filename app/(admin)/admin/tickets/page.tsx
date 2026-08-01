import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAdminTickets } from "@/lib/views/admin-tickets";
import { fmtMinutes } from "@/lib/support-package-helpers";
import { Card, CardHeader, PageHeader, StatusPill, type Health } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = { active: "Open", pending: "Pending", closed: "Closed" };
const STATUS_TONE: Record<string, Health> = { active: "warn", pending: "bad", closed: "good" };

export default async function AdminTicketsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  let tickets: Awaited<ReturnType<typeof getAdminTickets>> = [];
  let unavailable = false;
  try {
    tickets = await getAdminTickets();
  } catch {
    unavailable = true;
  }

  const open = tickets.filter((t) => t.status !== "closed");
  const untimed = open.filter((t) => t.loggedMinutes === 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        subtitle="Every recent ticket across all clients, with the time logged against it. Replying and logging time here keeps the hours honest."
      />

      {unavailable ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            The helpdesk isn&apos;t reachable right now — tickets will reappear when it&apos;s back.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Recent tickets"
            count={tickets.length}
            action={
              untimed > 0 ? (
                <span className="rounded-full bg-warn-tint px-2.5 py-1 text-xs font-semibold text-warn-ink">
                  {untimed} open with no time logged
                </span>
              ) : undefined
            }
          />
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Ticket</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Time</th>
                <th className="px-4 py-2.5 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5">
                    <StatusPill tone={STATUS_TONE[t.status] ?? "warn"} label={STATUS_LABEL[t.status] ?? t.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/tickets/${t.id}`} className="font-medium text-ink hover:text-brand">
                      {t.subject}
                    </Link>
                    <span className="ml-1.5 text-xs text-faint">#{t.number}</span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">
                    {t.clientName ?? <span className="text-faint">{t.customerEmail ?? "—"}</span>}
                  </td>
                  <td
                    className={`px-4 py-2.5 ${
                      t.loggedMinutes === 0 && t.status !== "closed" ? "font-semibold text-brand" : "text-ink-2"
                    }`}
                  >
                    {t.loggedMinutes ? fmtMinutes(t.loggedMinutes) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{t.updatedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
