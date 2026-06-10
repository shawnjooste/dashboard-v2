import { createClient } from "@/lib/supabase/server";
import { summarize, type DeviceHealth, type FleetSummary } from "./health";
import { getVisibleDeviceHealth } from "./devices";

export type ClientSummary = { id: string; name: string; summary: FleetSummary };

/** Per-client rollups for every client the caller can see that has devices. */
export async function getClientSummaries(): Promise<ClientSummary[]> {
  const supabase = await createClient();
  const [clients, devices] = await Promise.all([
    supabase.from("clients").select("id, name"),
    getVisibleDeviceHealth(),
  ]);
  const nameById = new Map((clients.data ?? []).map((c) => [c.id, c.name]));
  const byClient = new Map<string, DeviceHealth[]>();
  for (const d of devices) {
    (byClient.get(d.clientId) ?? byClient.set(d.clientId, []).get(d.clientId)!).push(d);
  }
  return [...byClient.entries()]
    .map(([id, list]) => ({ id, name: nameById.get(id) ?? "Unknown", summary: summarize(list) }))
    .sort((a, b) => b.summary.needsAttention - a.summary.needsAttention || b.summary.total - a.summary.total);
}

/** Devices for one client (admin drill-in / manager fleet). RLS still applies. */
export async function getClientDevices(clientId: string): Promise<{ name: string; devices: DeviceHealth[] }> {
  const supabase = await createClient();
  const [client, devices] = await Promise.all([
    supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
    getVisibleDeviceHealth(),
  ]);
  return {
    name: client.data?.name ?? "Client",
    devices: devices.filter((d) => d.clientId === clientId),
  };
}
