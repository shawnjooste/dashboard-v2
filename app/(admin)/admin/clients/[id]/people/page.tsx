import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getClientPeople } from "@/lib/views/people";

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
      <div>
        <Link href={`/admin/clients/${id}`} className="text-sm text-blue-600 hover:underline">
          ← {client?.name ?? "Client"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">People ({people.length})</h1>
      </div>

      {people.length === 0 ? (
        <p className="text-gray-500">No people yet — connect Microsoft 365 to populate the directory.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Microsoft 365</th>
                <th className="px-3 py-2">MFA</th>
                <th className="px-3 py-2">Portal</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/admin/people/${p.id}`} className="text-blue-600 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.email}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {p.hasM365 ? (p.licensed ? "Licensed" : "Unlicensed") : "—"}
                  </td>
                  <td className={`px-3 py-2 ${p.licensed && p.mfaStrong === false ? "text-red-600" : "text-gray-600"}`}>
                    {p.mfaStrong === null ? "—" : p.mfaStrong ? "On" : "Off"}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.portalRole ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
