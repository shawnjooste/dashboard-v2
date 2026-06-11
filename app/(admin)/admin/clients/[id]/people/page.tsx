import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getClientPeople } from "@/lib/views/people";
import { Card, PageHeader, SecondaryLink } from "@/components/ui";

export default async function ClientPeoplePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: client }, people] = await Promise.all([
    supabase.from("clients").select("name").eq("id", id).maybeSingle(),
    getClientPeople(id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${id}`} className="hover:text-ink">
            ← {client?.name ?? "Client"}
          </Link>
        }
        title={`People (${people.length})`}
        action={
          <SecondaryLink href={`/admin/clients/${id}/link-devices`}>
            Link devices →
          </SecondaryLink>
        }
      />

      {people.length === 0 ? (
        <p className="text-muted">No people yet — connect Microsoft 365 to populate the directory.</p>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Microsoft 365</th>
                <th className="px-4 py-2.5 font-semibold">MFA</th>
                <th className="px-4 py-2.5 font-semibold">Portal</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/admin/people/${p.id}`} className="text-ink hover:text-brand">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{p.email}</td>
                  <td className="px-4 py-2.5 text-ink-2">
                    {p.hasM365 ? (p.licensed ? "Licensed" : "Unlicensed") : "—"}
                  </td>
                  <td className={`px-4 py-2.5 ${p.mfaStrong === null ? "text-ink-2" : p.mfaStrong ? "text-good" : "text-brand"}`}>
                    {p.mfaStrong === null ? "—" : p.mfaStrong ? "On" : "Off"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{p.portalRole ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
