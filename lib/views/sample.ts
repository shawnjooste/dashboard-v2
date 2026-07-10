// Sample-data fallback for prospects. When a client has no real Devices or
// Microsoft 365 data, the portal renders the anonymized JoosteCo demo set
// (read via the service client, since RLS scopes a user to their own client)
// behind a "sample data" banner — a sales preview of what Rocking watches.
//
// Best-effort: every fetch is wrapped so a backend failure (e.g. a missing
// service role key, network blip) degrades to "no data" rather than crashing
// the prospect's portal.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { assembleDeviceHealth } from "./devices";
import { getM365View, type M365View } from "./m365";
import type { DeviceHealth } from "./health";

/** The anonymized JoosteCo demo client used as the sample source. */
export const SAMPLE_CLIENT_ID = "72b4f5b0-49a4-48d3-a8df-e021e768c0dc";

const M365_DISCONNECTED: M365View = {
  connected: false, tenantName: null, securityDefaultsOn: null, caPolicyCount: null,
  secureScore: null, secureScoreMax: null, activeLicensed: 0, mfaCoverage: null,
  passwordOnly: [], unlicensedEnabled: [], licenses: [], trend: [],
};

export async function getSampleDeviceHealth(): Promise<DeviceHealth[]> {
  try {
    const sb = createServiceClient();
    const { data: devices } = await sb
      .from("devices")
      .select("id, client_id, hostname, assigned_user_label, operating_system, av_ok, disposition")
      .eq("client_id", SAMPLE_CLIENT_ID);
    const ids = (devices ?? []).map((d) => d.id);
    if (ids.length === 0) return [];
    const [patch, storage, alerts] = await Promise.all([
      sb.from("device_patch_status").select("device_id, patch_status, patches_installed, patches_approved_pending").in("device_id", ids),
      sb.from("device_storage").select("device_id, used_pct, drive_type").in("device_id", ids),
      sb.from("device_alerts").select("device_id, resolved").in("device_id", ids),
    ]);
    return assembleDeviceHealth(devices ?? [], patch.data ?? [], storage.data ?? [], alerts.data ?? []);
  } catch (e) {
    console.error("sample devices failed:", e);
    return [];
  }
}

export async function getSampleFleetPatchTrend(): Promise<number[]> {
  try {
    const sb = createServiceClient();
    const { data } = await sb
      .from("device_health_snapshots")
      .select("snapshot_date, patch_pct")
      .eq("client_id", SAMPLE_CLIENT_ID);
    const byDate = new Map<string, number[]>();
    for (const r of data ?? []) {
      if (r.patch_pct === null) continue;
      (byDate.get(r.snapshot_date) ?? byDate.set(r.snapshot_date, []).get(r.snapshot_date)!).push(r.patch_pct);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => Math.round(v.reduce((n, x) => n + x, 0) / v.length));
  } catch (e) {
    console.error("sample patch trend failed:", e);
    return [];
  }
}

export async function getSampleM365View(): Promise<M365View> {
  try {
    return await getM365View(SAMPLE_CLIENT_ID, createServiceClient());
  } catch (e) {
    console.error("sample m365 failed:", e);
    return M365_DISCONNECTED;
  }
}
