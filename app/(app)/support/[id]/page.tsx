import Link from "next/link";
import { redirect } from "next/navigation";
import { getConversation, getSupportScope } from "@/lib/freescout";
import { canAccessConversation, htmlToText } from "@/lib/freescout-scope";
import { ReplyForm } from "./ReplyForm";

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

  if (unavailable) {
    return (
      <div className="space-y-4">
        <Link href="/support" className="text-sm text-blue-600 hover:underline">← Support</Link>
        <p className="text-gray-500">Support is temporarily unavailable — please try again shortly.</p>
      </div>
    );
  }

  if (!ticket || !canAccessConversation(ticket.customerEmail, scope.email, scope.clientDomains)) {
    return (
      <div className="space-y-4">
        <Link href="/support" className="text-sm text-blue-600 hover:underline">← Support</Link>
        <p className="text-gray-500">Ticket not found.</p>
      </div>
    );
  }

  const closed = ticket.status === "closed";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/support" className="text-sm text-blue-600 hover:underline">← Support</Link>
      <div>
        <h1 className="text-xl font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-sm text-gray-500">
          #{ticket.id} · {closed ? "Closed" : "Open"}
          {scope.isManager && ticket.customerEmail !== scope.email
            ? ` · ${ticket.customerEmail}`
            : ""}
        </p>
      </div>

      <ul className="space-y-3">
        {ticket.threads.map((t) => (
          <li
            key={t.id}
            className={`rounded-lg border p-4 ${
              t.type === "customer"
                ? "border-gray-200 bg-white"
                : "border-blue-100 bg-blue-50"
            }`}
          >
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span className="font-medium">{t.authorName}</span>
              <span>{t.createdAt.slice(0, 16).replace("T", " ")}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{htmlToText(t.body)}</p>
          </li>
        ))}
      </ul>

      <ReplyForm ticketId={ticket.id} closed={closed} />
    </div>
  );
}
