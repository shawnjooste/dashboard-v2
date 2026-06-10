import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getSupportScope,
  listConversationsByEmail,
  listRecentConversations,
  type TicketSummary,
} from "@/lib/freescout";
import { filterConversations } from "@/lib/freescout-scope";

const STATUS_LABEL: Record<string, string> = {
  active: "Open",
  pending: "Pending",
  closed: "Closed",
};

function StatusBadge({ status }: { status: string }) {
  const open = status !== "closed";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        open ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Support</h1>
        <Link
          href="/support/new"
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          New ticket
        </Link>
      </div>

      {unavailable ? (
        <p className="text-gray-500">
          Support is temporarily unavailable — please try again in a few minutes.
        </p>
      ) : tickets.length === 0 ? (
        <p className="text-gray-500">No tickets yet. Need help? Open one.</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/support/${t.id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t.subject}</span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="mt-1 truncate text-sm text-gray-500">{t.preview}</div>
                <div className="mt-1 text-xs text-gray-400">
                  #{t.number}
                  {scope.isManager && t.customerEmail !== scope.email
                    ? ` · ${t.customerEmail}`
                    : ""}
                  {" · "}
                  {t.updatedAt.slice(0, 10)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
