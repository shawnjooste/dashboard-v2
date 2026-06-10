import type { DeviceHealth } from "@/lib/views/health";
import { AttentionBadge } from "./AttentionBadge";

export function DeviceHealthCard({ device }: { device: DeviceHealth }) {
  const lines: string[] = [];
  if (device.flags.avOff) lines.push("Antivirus is not running.");
  if (device.flags.diskFull) lines.push(`Disk is nearly full (${Math.round(device.maxDiskPct ?? 0)}% used).`);
  if (device.flags.patchIssue) lines.push(`Updates need attention (${device.patchStatus}).`);
  if (device.flags.openAlerts) lines.push(`${device.openAlerts} open alert${device.openAlerts === 1 ? "" : "s"}.`);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{device.hostname}</h2>
        <AttentionBadge ok={!device.needsAttention} />
      </div>
      <p className="mt-1 text-sm text-gray-500">{device.os ?? ""}</p>
      <p className="mt-4 text-sm">
        {device.needsAttention
          ? lines.join(" ")
          : "Your machine is healthy — up to date, antivirus on, plenty of disk space."}
      </p>
    </div>
  );
}
