import type { DeviceHealth } from "@/lib/views/health";
import { Card } from "./ui/Card";
import { StatusBadge } from "./ui/status";

export function DeviceHealthCard({ device }: { device: DeviceHealth }) {
  const lines: string[] = [];
  if (device.flags.avOff) lines.push("Antivirus is not running.");
  if (device.flags.diskFull) lines.push(`Disk is nearly full (${Math.round(device.maxDiskPct ?? 0)}% used).`);
  if (device.flags.patchIssue) lines.push(`Updates need attention (${device.patchStatus}).`);
  if (device.flags.openAlerts) lines.push(`${device.openAlerts} open alert${device.openAlerts === 1 ? "" : "s"}.`);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{device.hostname}</h2>
        <StatusBadge tone={device.needsAttention ? "bad" : "good"} label={device.needsAttention ? "Needs attention" : "Healthy"} />
      </div>
      <p className="mt-1 text-sm text-muted">{device.os ?? ""}</p>
      <p className="mt-4 text-sm text-ink-2">
        {device.needsAttention
          ? lines.join(" ")
          : "Your machine is healthy — up to date, antivirus on, plenty of disk space."}
      </p>
    </Card>
  );
}
