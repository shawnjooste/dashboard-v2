import "server-only";
import { mapLibrenmsDevice, type LineStatus } from "@/lib/connectivity-helpers";

const TIMEOUT_MS = 3000;

/** Live line status from LibreNMS. Missing env or any failure → up:null for
 *  that device. Never throws — a monitoring hiccup must not break the page. */
export async function getLineStatuses(deviceIds: number[]): Promise<Map<number, LineStatus>> {
  const out = new Map<number, LineStatus>();
  const url = process.env.LIBRENMS_URL;
  const key = process.env.LIBRENMS_API_KEY;
  const unknown: LineStatus = { up: null, downSince: null };
  if (!url || !key || deviceIds.length === 0) {
    for (const id of deviceIds) out.set(id, unknown);
    return out;
  }
  await Promise.all(
    deviceIds.map(async (id) => {
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/api/v0/devices/${id}`, {
          headers: { "X-Auth-Token": key },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        // API returns { devices: [ {...} ] }
        out.set(id, mapLibrenmsDevice(body?.devices?.[0] ?? null, Date.now()));
      } catch {
        out.set(id, unknown);
      }
    }),
  );
  return out;
}
