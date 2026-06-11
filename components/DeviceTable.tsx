import Link from "next/link";
import type { DeviceHealth } from "@/lib/views/health";
import { StatusPill } from "./ui/status";

export function DeviceTable({
  devices,
  rowHref,
}: {
  devices: DeviceHealth[];
  rowHref?: (id: string) => string;
}) {
  if (devices.length === 0)
    return (
      <div className="rounded-lg border border-line bg-card px-4 py-6 text-sm text-muted">
        No devices.
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Device</th>
            <th className="px-4 py-2.5 font-semibold">User</th>
            <th className="px-4 py-2.5 font-semibold">OS</th>
            <th className="px-4 py-2.5 font-semibold">Patch</th>
            <th className="px-4 py-2.5 font-semibold">Disk</th>
            <th className="px-4 py-2.5 font-semibold">AV</th>
            <th className="px-4 py-2.5 font-semibold">Alerts</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
              <td className="px-4 py-2.5 font-medium">
                {rowHref ? (
                  <Link href={rowHref(d.id)} className="text-ink hover:text-brand">
                    {d.hostname}
                  </Link>
                ) : (
                  d.hostname
                )}
              </td>
              <td className="px-4 py-2.5 text-ink-2">{d.user ?? "—"}</td>
              <td className="px-4 py-2.5 text-muted">{d.os ?? "—"}</td>
              <td className={`px-4 py-2.5 ${d.flags.patchIssue ? "font-medium text-brand" : "text-muted"}`}>
                {d.patchStatus ?? "—"}
              </td>
              <td className={`px-4 py-2.5 ${d.flags.diskFull ? "font-medium text-brand" : "text-muted"}`}>
                {d.maxDiskPct === null ? "—" : `${Math.round(d.maxDiskPct)}%`}
              </td>
              <td className={`px-4 py-2.5 ${d.flags.avOff ? "font-medium text-brand" : "text-muted"}`}>
                {d.avOk === false ? "Off" : d.avOk === true ? "On" : "—"}
              </td>
              <td className={`px-4 py-2.5 ${d.flags.openAlerts ? "font-medium text-warn" : "text-muted"}`}>
                {d.openAlerts}
              </td>
              <td className="px-4 py-2.5">
                <StatusPill tone={d.needsAttention ? "bad" : "good"} label={d.needsAttention ? "Needs attention" : "Healthy"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
