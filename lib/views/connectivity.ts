import { createClient } from "@/lib/supabase/server";
import { getLineStatuses } from "@/lib/librenms";
import { speedLabel, type LineStatus } from "@/lib/connectivity-helpers";

export type ConnectivityLine = {
  id: string;
  label: string;
  kind: string;
  provider: string | null;
  speed: string | null;
  librenmsDeviceId: number | null;
  notes: string | null;
  isActive: boolean;
  status: LineStatus | null;
};

/** A client's lines with live status for mapped ones. RLS scopes rows:
 *  clients see only their own active lines; staff may includeInactive. */
export async function getConnectivityLines(
  clientId: string,
  opts?: { includeInactive?: boolean },
): Promise<ConnectivityLine[]> {
  const supabase = await createClient();
  let q = supabase
    .from("connectivity_services")
    .select("id, label, kind, provider, download_mbps, upload_mbps, librenms_device_id, notes, is_active")
    .eq("client_id", clientId)
    .order("label");
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  const rows = data ?? [];
  const ids = rows.map((r) => r.librenms_device_id).filter((n): n is number => n != null);
  const statuses = await getLineStatuses([...new Set(ids)]);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    provider: r.provider,
    speed: speedLabel(r.download_mbps, r.upload_mbps),
    librenmsDeviceId: r.librenms_device_id,
    notes: r.notes,
    isActive: r.is_active,
    status: r.librenms_device_id != null ? (statuses.get(r.librenms_device_id) ?? null) : null,
  }));
}

/** Cheap existence check for nav gating. */
export async function hasConnectivity(clientId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("connectivity_services")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("is_active", true);
  return (count ?? 0) > 0;
}
