import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getComplianceDocuments } from "@/lib/views/compliance-documents";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";

export default async function BillingDocumentsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "billing")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const docs = await getComplianceDocuments();

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      <BillingTabs active="documents" />

      <Card>
        <CardHeader title="Compliance documents" count={docs.length} />
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No documents available yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-4 py-2.5 font-semibold">Added</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">{d.description}</td>
                  <td className="px-4 py-2.5 text-ink-3">
                    {new Date(d.createdAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-brand hover:underline"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-[13px] text-muted">Unavailable</span>
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
