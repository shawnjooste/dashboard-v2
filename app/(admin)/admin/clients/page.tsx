import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth } from "@/lib/views/devices";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const [clients, devices] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    getVisibleDeviceHealth(),
  ]);

  const countsBy = new Map<string, { total: number; attention: number }>();
  for (const d of devices) {
    const c = countsBy.get(d.clientId) ?? { total: 0, attention: 0 };
    c.total += 1;
    if (d.needsAttention) c.attention += 1;
    countsBy.set(d.clientId, c);
  }

  const rows = clients.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Clients ({rows.length})</h1>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Devices</th>
              <th className="px-3 py-2">Need attention</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const counts = countsBy.get(c.id);
              return (
                <tr key={c.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {counts ? (
                      <Link href={`/admin/clients/${c.id}`} className="text-blue-600 hover:underline">
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {counts?.total ?? <span className="text-gray-400">no devices yet</span>}
                  </td>
                  <td className={`px-3 py-2 ${counts?.attention ? "text-red-600" : "text-gray-600"}`}>
                    {counts ? counts.attention : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
