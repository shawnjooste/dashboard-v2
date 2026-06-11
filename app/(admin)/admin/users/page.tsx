import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAllPeople } from "@/lib/views/people";
import { Card, PageHeader } from "@/components/ui";
import { ClientFilter } from "./ClientFilter";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: clientId } = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, people] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    getAllPeople(clientId || undefined),
  ]);

  const selectedName = clientId
    ? (clients ?? []).find((c) => c.id === clientId)?.name
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Users (${people.length})`}
        subtitle={
          selectedName
            ? `People at ${selectedName} — licences, sign-in security and portal access.`
            : "Everyone across all clients — licences, sign-in security and portal access."
        }
        action={<ClientFilter clients={clients ?? []} selected={clientId ?? ""} />}
      />

      {people.length === 0 ? (
        <p className="text-muted">
          No people yet — connect Microsoft 365 to populate the directory.
        </p>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
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
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/clients/${p.clientId}/people`}
                      className="text-ink-2 hover:text-brand"
                    >
                      {p.clientName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{p.email}</td>
                  <td className="px-4 py-2.5 text-ink-2">
                    {p.hasM365 ? (p.licensed ? "Licensed" : "Unlicensed") : "—"}
                  </td>
                  <td
                    className={`px-4 py-2.5 ${p.mfaStrong === null ? "text-ink-2" : p.mfaStrong ? "text-good" : "text-brand"}`}
                  >
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
