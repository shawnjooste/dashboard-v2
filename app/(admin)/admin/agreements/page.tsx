import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAgreements } from "@/lib/views/agreements";
import { Card, CardHeader, PageHeader, PrimaryLink } from "@/components/ui";
import { fmtDate } from "@/lib/time";
import { AGREEMENT_STATUSES, STATUS_LABEL, STATUS_STYLE } from "./status";

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; client?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const params = await searchParams;
  const status = AGREEMENT_STATUSES.includes(params.status as (typeof AGREEMENT_STATUSES)[number])
    ? params.status
    : undefined;
  const clientId = params.client || undefined;

  const all = await getAgreements();
  const rows = all.filter((a) => (!status || a.status === status) && (!clientId || a.clientId === clientId));
  const clients = [...new Map(all.map((a) => [a.clientId, a.clientName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ status: status ?? "", client: clientId ?? "", ...over });
    for (const k of [...p.keys()]) if (!p.get(k)) p.delete(k);
    const s = p.toString();
    return `/admin/agreements${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-[12.5px] font-semibold ${active ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agreements"
        subtitle="Agreements written here, read and signed by the client in the portal. A signed agreement is frozen — the wording and the signature can never be edited."
        action={<PrimaryLink href="/admin/agreements/new">New agreement</PrimaryLink>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ status: "" })} className={chip(!status)}>
          All
        </Link>
        {AGREEMENT_STATUSES.map((s) => (
          <Link key={s} href={qs({ status: s })} className={chip(status === s)}>
            {STATUS_LABEL[s]}
          </Link>
        ))}
        {clients.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            {clientId && (
              <Link href={qs({ client: "" })} className="text-[12.5px] font-semibold text-muted hover:text-ink">
                Clear client
              </Link>
            )}
            {/* Plain links keep this a server page — no client JS for a filter. */}
            <div className="flex flex-wrap gap-1.5">
              {clients.map(([id, name]) => (
                <Link key={id} href={qs({ client: id })} className={chip(clientId === id)}>
                  {name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader title="Agreements" count={rows.length} />
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted">
            {all.length === 0
              ? "No agreements yet. Write the first one — it lives in the portal, and the client signs it there."
              : "Nothing matches this filter."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Reference</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Sent</th>
                <th className="px-4 py-2.5 font-semibold">Signed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/agreements/${a.id}`} className="font-medium tabular-nums text-ink hover:text-brand">
                      {a.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{a.clientName}</td>
                  <td className="px-4 py-2.5 text-ink-2">{a.title}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[a.status]}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{fmtDate(a.sentAt)}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {a.signedAt ? (
                      <span title={a.signerName ?? undefined}>{fmtDate(a.signedAt)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
