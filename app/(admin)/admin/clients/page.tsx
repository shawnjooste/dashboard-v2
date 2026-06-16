import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { getAllPeople } from "@/lib/views/people";
import { ClientsView, type ClientRow } from "./ClientsView";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const [clientsRes, devices, people] = await Promise.all([
    supabase.from("clients").select("id, name, status").order("name"),
    getVisibleDeviceHealth(),
    getAllPeople(),
  ]);

  const dev = new Map<string, { total: number; attention: number }>();
  for (const d of devices) {
    const c = dev.get(d.clientId) ?? { total: 0, attention: 0 };
    c.total += 1;
    if (d.needsAttention) c.attention += 1;
    dev.set(d.clientId, c);
  }

  const ppl = new Map<string, number>();
  for (const p of people) ppl.set(p.clientId, (ppl.get(p.clientId) ?? 0) + 1);

  const rows: ClientRow[] = (clientsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    people: ppl.get(c.id) ?? 0,
    devices: dev.get(c.id)?.total ?? 0,
    attention: dev.get(c.id)?.attention ?? 0,
    archived: c.status === "inactive",
  }));

  return <ClientsView clients={rows} />;
}
