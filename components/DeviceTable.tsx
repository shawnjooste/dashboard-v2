import type { DeviceHealth } from "@/lib/views/health";
import { AttentionBadge } from "./AttentionBadge";

export function DeviceTable({ devices }: { devices: DeviceHealth[] }) {
  if (devices.length === 0)
    return <p className="text-gray-500">No devices.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">OS</th>
            <th className="px-3 py-2">Patch</th>
            <th className="px-3 py-2">Disk</th>
            <th className="px-3 py-2">AV</th>
            <th className="px-3 py-2">Alerts</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2 font-medium">{d.hostname}</td>
              <td className="px-3 py-2 text-gray-600">{d.user ?? "—"}</td>
              <td className="px-3 py-2 text-gray-600">{d.os ?? "—"}</td>
              <td className={`px-3 py-2 ${d.flags.patchIssue ? "text-red-600" : "text-gray-600"}`}>
                {d.patchStatus ?? "—"}
              </td>
              <td className={`px-3 py-2 ${d.flags.diskFull ? "text-red-600" : "text-gray-600"}`}>
                {d.maxDiskPct === null ? "—" : `${Math.round(d.maxDiskPct)}%`}
              </td>
              <td className={`px-3 py-2 ${d.flags.avOff ? "text-red-600" : "text-gray-600"}`}>
                {d.avOk === false ? "Off" : d.avOk === true ? "On" : "—"}
              </td>
              <td className={`px-3 py-2 ${d.flags.openAlerts ? "text-red-600" : "text-gray-600"}`}>
                {d.openAlerts}
              </td>
              <td className="px-3 py-2"><AttentionBadge ok={!d.needsAttention} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
