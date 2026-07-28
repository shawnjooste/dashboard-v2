import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getComplianceDocuments } from "@/lib/views/compliance-documents";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { ComplianceUpload } from "./ComplianceUpload";
import { deleteComplianceDocument } from "./actions";

export default async function CompliancePage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");

  const docs = await getComplianceDocuments();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance docs"
        subtitle="Rocking's own paperwork, shared with every client manager. Nothing client-specific belongs here."
      />

      <Card>
        <CardHeader title="Upload a document" />
        <div className="p-4">
          <ComplianceUpload />
        </div>
      </Card>

      <Card>
        <CardHeader title="Documents" count={docs.length} />
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No documents uploaded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Uploaded</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">{d.description}</td>
                  <td className="px-4 py-2.5 text-ink-3">{new Date(d.createdAt).toLocaleDateString("en-ZA")}</td>
                  <td className="px-4 py-2.5 text-right">
                    <form
                      action={async () => {
                        "use server";
                        await deleteComplianceDocument(d.id);
                      }}
                    >
                      <button type="submit" className="text-[13px] font-semibold text-brand hover:underline">
                        Delete
                      </button>
                    </form>
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
