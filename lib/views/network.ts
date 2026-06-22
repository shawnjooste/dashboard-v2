import { createClient } from "@/lib/supabase/server";

export type NetStatus = "online" | "offline" | "alerting" | "degraded" | null;
export type Overall = "healthy" | "issues" | "down";

export type NetDevice = {
  id: string;
  name: string;
  kind: string | null;
  model: string | null;
  status: NetStatus;
  ip: string | null;
  lastSeenAt: string | null;
};

export type NetTrendPoint = { date: string; up: number; total: number };

export type ClientNetwork = {
  overall: Overall;
  deviceCount: number;
  onlineCount: number;
  clientCount: number;
  siteCount: number;
  lastSyncAt: string | null;
  uptimePct: number | null;
  devices: NetDevice[];
  trend: NetTrendPoint[];
};

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

/** A friendly label for a device whose name is unset or just a MAC/serial. */
export function deviceLabel(d: Pick<NetDevice, "name" | "kind" | "model">): string {
  if (d.name && !MAC.test(d.name)) return d.name;
  const kind =
    d.kind === "gateway" ? "Gateway" : d.kind === "switch" ? "Switch" : d.kind === "ap" ? "Access point" : "Device";
  return d.model ? `${kind} · ${d.model}` : kind;
}

/** The caller's own network (RLS-scoped). Null when nothing has been ingested. */
export async function getClientNetwork(): Promise<ClientNetwork | null> {
  const supabase = await createClient();
  const [{ data: sites }, { data: devices }, { data: snaps }] = await Promise.all([
    supabase.from("network_sites").select("id, status, client_count, last_seen_at"),
    supabase
      .from("network_devices")
      .select("id, name, kind, model, status, ip, last_seen_at")
      .order("kind", { ascending: true }),
    supabase
      .from("network_health_snapshots")
      .select("snapshot_date, devices_up, devices_total")
      .order("snapshot_date", { ascending: true })
      .limit(30),
  ]);

  if (!sites?.length && !devices?.length) return null;

  const devs: NetDevice[] = (devices ?? []).map((d) => ({
    id: d.id,
    name: d.name ?? "",
    kind: d.kind,
    model: d.model,
    status: d.status as NetStatus,
    ip: d.ip,
    lastSeenAt: d.last_seen_at,
  }));

  const onlineCount = devs.filter((d) => d.status === "online").length;
  const anyDown = (sites ?? []).some((s) => s.status === "offline");
  const anyIssue =
    devs.some((d) => d.status === "offline" || d.status === "alerting") ||
    (sites ?? []).some((s) => s.status === "degraded");
  const overall: Overall = anyDown ? "down" : anyIssue ? "issues" : "healthy";

  const clientCount = (sites ?? []).reduce((n, s) => n + (s.client_count ?? 0), 0);
  const lastSyncAt =
    (sites ?? []).map((s) => s.last_seen_at).filter(Boolean).sort().at(-1) ?? null;

  const trend: NetTrendPoint[] = (snaps ?? []).map((s) => ({
    date: s.snapshot_date,
    up: s.devices_up ?? 0,
    total: s.devices_total ?? 0,
  }));
  const totUp = trend.reduce((n, t) => n + t.up, 0);
  const totAll = trend.reduce((n, t) => n + t.total, 0);
  const uptimePct = totAll > 0 ? Math.round((100 * totUp) / totAll) : null;

  return {
    overall,
    deviceCount: devs.length,
    onlineCount,
    clientCount,
    siteCount: (sites ?? []).length,
    lastSyncAt,
    uptimePct,
    devices: devs,
    trend,
  };
}
