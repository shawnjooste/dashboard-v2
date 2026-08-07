import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getAgreements } from "@/lib/views/agreements";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/time";

export default async function ClientAgreementsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "agreements")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const rows = await getAgreements();
  const awaiting = rows.filter((a) => a.status === "sent");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agreements"
        subtitle="Your agreements with Rocking One. They stay here permanently — sign in the portal, and download a PDF copy for your records."
      />

      {awaiting.length > 0 && (
        <div className="rounded-lg border border-warn-line bg-warn-tint-2 px-4 py-3 text-sm font-medium text-warn-ink">
          {awaiting.length === 1
            ? "One agreement is waiting for your signature."
            : `${awaiting.length} agreements are waiting for your signature.`}
        </div>
      )}

      <Card>
        <CardHeader title="Agreements" count={rows.length} />
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted">
            You have no agreements yet. When we send you one, it appears here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Agreement</th>
                <th className="px-4 py-2.5 font-semibold">Reference</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Signed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5">
                    <Link href={`/agreements/${a.id}`} className="font-medium text-ink hover:text-brand">
                      {a.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{a.reference}</td>
                  <td className="px-4 py-2.5">
                    {a.status === "signed" ? (
                      <span className="rounded-full bg-good-tint px-2.5 py-0.5 text-[11.5px] font-semibold text-good">
                        Signed
                      </span>
                    ) : a.status === "sent" ? (
                      <Link
                        href={`/agreements/${a.id}`}
                        className="rounded-full bg-warn-tint px-2.5 py-0.5 text-[11.5px] font-semibold text-warn-ink hover:underline"
                      >
                        Needs your signature
                      </Link>
                    ) : (
                      <span className="rounded-full bg-line-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-faint">
                        Withdrawn
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {a.signedAt ? `${fmtDate(a.signedAt)}${a.signerName ? ` · ${a.signerName}` : ""}` : "—"}
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
