import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { PageHeader, Card } from "@/components/ui";

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
      <PageHeader title="Clients" subtitle={`${rows.length} total`} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Devices</th>
                <th className="px-4 py-2.5 font-semibold">Need attention</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const counts = countsBy.get(c.id);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-line-soft last:border-0 hover:bg-canvas"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {counts ? (
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="text-ink hover:text-brand"
                        >
                          {c.name}
                        </Link>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">
                      {counts?.total ?? <span className="text-faint">no devices yet</span>}
                    </td>
                    <td
                      className={`px-4 py-2.5 ${counts?.attention ? "text-brand" : "text-good"}`}
                    >
                      {counts ? counts.attention : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
