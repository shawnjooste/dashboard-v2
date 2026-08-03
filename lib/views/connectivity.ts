import { createClient } from "@/lib/supabase/server";
import { speedLabel } from "@/lib/connectivity-helpers";

export type ConnectivitySample = { at: string; latencyMs: number | null };

/** One step in the path a client's connectivity takes. */
export type PathHop = {
  id: string;
  position: number;
  label: string;
  kind: string;
  detail: string | null;
  /** Shares an upstream with the hop before it — same step, redundant leg. */
  parallelWithPrevious: boolean;
  librenmsDeviceId: number | null;
  lastUp: boolean | null;
  latencyMs: number | null;
  lastCheckedAt: string | null;
};

export type ConnectivityLine = {
  id: string;
  label: string;
  kind: string;
  provider: string | null;
  speed: string | null;
  /** Raw values, so the admin edit form can prefill without wiping them. */
  downloadMbps: number | null;
  uploadMbps: number | null;
  description: string | null;
  connType: string;
  pppoeUsername: string | null;
  /** True when a password is stored — the value itself never ships here. */
  hasSecret: boolean;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  dnsServers: string | null;
  vlan: number | null;
  librenmsDeviceId: number | null;
  notes: string | null;
  isActive: boolean;
  lastUp: boolean | null;
  latencyMs: number | null;
  lossPct: number | null;
  lastCheckedAt: string | null;
  downSince: string | null;
  samples: ConnectivitySample[];
  hops: PathHop[];
};

/** A client's lines with the status the pull last wrote, plus 24h of samples.
 *  RLS scopes rows; pppoe_secret is read only to derive hasSecret and is never
 *  placed on the returned objects. */
export async function getConnectivityLines(
  clientId: string,
  opts?: { includeInactive?: boolean },
): Promise<ConnectivityLine[]> {
  const supabase = await createClient();
  let q = supabase
    .from("connectivity_services")
    .select(
      "id, label, kind, provider, download_mbps, upload_mbps, description, conn_type, pppoe_username, pppoe_secret, ip_address, subnet_mask, gateway, dns_servers, vlan, librenms_device_id, notes, is_active, last_up, latency_ms, loss_pct, last_checked_at, down_since",
    )
    .eq("client_id", clientId)
    .order("label");
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: sampleRows } = await supabase
    .from("connectivity_samples")
    .select("service_id, at, latency_ms")
    .in(
      "service_id",
      rows.map((r) => r.id),
    )
    .gte("at", since)
    .order("at");
  const { data: hopRows } = await supabase
    .from("connectivity_path_hops")
    .select("id, service_id, position, label, kind, detail, parallel_with_previous, librenms_device_id, last_up, latency_ms, last_checked_at")
    .in(
      "service_id",
      rows.map((r) => r.id),
    )
    .order("position");
  const hopsByService = new Map<string, PathHop[]>();
  for (const h of hopRows ?? []) {
    const list = hopsByService.get(h.service_id) ?? [];
    list.push({
      id: h.id,
      position: h.position,
      label: h.label,
      kind: h.kind,
      detail: h.detail,
      parallelWithPrevious: h.parallel_with_previous,
      librenmsDeviceId: h.librenms_device_id,
      lastUp: h.last_up,
      latencyMs: h.latency_ms == null ? null : Number(h.latency_ms),
      lastCheckedAt: h.last_checked_at,
    });
    hopsByService.set(h.service_id, list);
  }

  const byService = new Map<string, ConnectivitySample[]>();
  for (const s of sampleRows ?? []) {
    const list = byService.get(s.service_id) ?? [];
    list.push({ at: s.at, latencyMs: s.latency_ms == null ? null : Number(s.latency_ms) });
    byService.set(s.service_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    provider: r.provider,
    speed: speedLabel(r.download_mbps, r.upload_mbps),
    downloadMbps: r.download_mbps,
    uploadMbps: r.upload_mbps,
    description: r.description,
    connType: r.conn_type,
    pppoeUsername: r.pppoe_username,
    hasSecret: !!r.pppoe_secret,
    ipAddress: r.ip_address,
    subnetMask: r.subnet_mask,
    gateway: r.gateway,
    dnsServers: r.dns_servers,
    vlan: r.vlan,
    librenmsDeviceId: r.librenms_device_id,
    notes: r.notes,
    isActive: r.is_active,
    lastUp: r.last_up,
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    lossPct: r.loss_pct == null ? null : Number(r.loss_pct),
    lastCheckedAt: r.last_checked_at,
    downSince: r.down_since,
    samples: byService.get(r.id) ?? [],
    hops: hopsByService.get(r.id) ?? [],
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
