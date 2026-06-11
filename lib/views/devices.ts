import { createClient } from "@/lib/supabase/server";
import { deviceHealth, type DeviceHealth, type DeviceInputs } from "./health";

/**
 * Returns the health of every device the caller can see (RLS-scoped):
 * staff = all, manager = their client, member = their assigned device(s).
 */
export async function getVisibleDeviceHealth(): Promise<DeviceHealth[]> {
  const supabase = await createClient();
  const [devices, patch, storage, alerts] = await Promise.all([
    supabase.from("devices").select("id, client_id, hostname, assigned_user_label, operating_system, av_ok"),
    supabase.from("device_patch_status").select("device_id, patch_status, patches_installed, patches_approved_pending"),
    supabase.from("device_storage").select("device_id, used_pct, drive_type"),
    supabase.from("device_alerts").select("device_id, resolved"),
  ]);

  const patchBy = new Map((patch.data ?? []).map((p) => [p.device_id, p]));
  const disksBy = new Map<string, number[]>();
  for (const s of storage.data ?? []) {
    if (s.used_pct === null || !(s.drive_type ?? "").toLowerCase().includes("local")) continue;
    (disksBy.get(s.device_id) ?? disksBy.set(s.device_id, []).get(s.device_id)!).push(Number(s.used_pct));
  }
  const openBy = new Map<string, number>();
  for (const a of alerts.data ?? []) {
    if (a.resolved) continue;
    openBy.set(a.device_id, (openBy.get(a.device_id) ?? 0) + 1);
  }

  return (devices.data ?? []).map((d) => {
    const p = patchBy.get(d.id);
    const inputs: DeviceInputs = {
      id: d.id,
      clientId: d.client_id,
      hostname: d.hostname,
      user: d.assigned_user_label,
      os: d.operating_system,
      avOk: d.av_ok,
      patchStatus: p?.patch_status ?? null,
      patchesInstalled: p?.patches_installed ?? null,
      patchesPending: p?.patches_approved_pending ?? null,
      usedPcts: disksBy.get(d.id) ?? [],
      openAlerts: openBy.get(d.id) ?? 0,
    };
    return deviceHealth(inputs);
  });
}

/** Fleet-average patch % per snapshot date (RLS-scoped), oldest first.
 *  Feeds the dashboard sparkline; grows with each scheduled pull. */
export async function getFleetPatchTrend(): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("device_health_snapshots")
    .select("snapshot_date, patch_pct");
  const byDate = new Map<string, number[]>();
  for (const r of data ?? []) {
    if (r.patch_pct === null) continue;
    const arr = byDate.get(r.snapshot_date) ?? [];
    arr.push(r.patch_pct);
    byDate.set(r.snapshot_date, arr);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => Math.round(v.reduce((n, x) => n + x, 0) / v.length));
}

export type DeviceMeta = {
  lastReboot: string | null;
  serial: string | null;
  agentVersion: string | null;
  manufacturer: string | null;
  model: string | null;
};

export type DeviceDetail = {
  health: DeviceHealth;
  meta: DeviceMeta;
  drives: { drive: string; sizeGb: number | null; usedPct: number | null }[];
  alerts: { triggeredAt: string; message: string; priority: string | null; resolved: boolean }[];
  trend: { date: string; patchPct: number | null; maxDiskPct: number | null; openAlerts: number | null }[];
};

/** Full detail for one device (RLS still applies — returns null if not visible). */
export async function getDeviceDetail(deviceId: string): Promise<DeviceDetail | null> {
  const supabase = await createClient();
  const all = await getVisibleDeviceHealth();
  const health = all.find((d) => d.id === deviceId);
  if (!health) return null;

  const [meta, drives, alerts, snaps] = await Promise.all([
    supabase.from("devices").select("last_reboot, serial_number, agent_version, manufacturer, model").eq("id", deviceId).maybeSingle(),
    supabase.from("device_storage").select("drive, size_gb, used_pct").eq("device_id", deviceId),
    supabase.from("device_alerts").select("triggered_at, message, priority, resolved").eq("device_id", deviceId).order("triggered_at", { ascending: false }).limit(20),
    supabase.from("device_health_snapshots").select("snapshot_date, patch_pct, max_disk_pct, open_alert_count").eq("device_id", deviceId).order("snapshot_date"),
  ]);

  return {
    health,
    meta: {
      lastReboot: meta.data?.last_reboot ?? null,
      serial: meta.data?.serial_number ?? null,
      agentVersion: meta.data?.agent_version ?? null,
      manufacturer: meta.data?.manufacturer ?? null,
      model: meta.data?.model ?? null,
    },
    drives: (drives.data ?? []).map((d) => ({ drive: d.drive, sizeGb: d.size_gb, usedPct: d.used_pct })),
    alerts: (alerts.data ?? []).map((a) => ({ triggeredAt: a.triggered_at, message: a.message, priority: a.priority, resolved: a.resolved })),
    trend: (snaps.data ?? []).map((s) => ({ date: s.snapshot_date, patchPct: s.patch_pct, maxDiskPct: s.max_disk_pct, openAlerts: s.open_alert_count })),
  };
}
