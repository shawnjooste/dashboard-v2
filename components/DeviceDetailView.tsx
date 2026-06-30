import type { DeviceDetail } from "@/lib/views/devices";
import { DeviceHealthCard } from "./DeviceHealthCard";
import { DeviceAlerts } from "./DeviceAlerts";
import { Sparkline } from "./Sparkline";
import { Card, CardHeader } from "./ui/Card";

const fmt = (ts: string | null) => (ts ? ts.replace("T", " ").slice(0, 16) : "—");

export function DeviceDetailView({ detail }: { detail: DeviceDetail }) {
  const { health, meta, drives, alerts, trend } = detail;
  const metaItems = [
    { label: "Status", value: meta.online == null ? "—" : meta.online ? "Online" : "Offline" },
    { label: "Last seen", value: fmt(meta.lastSeen) },
    { label: "Operating system", value: health.os ?? "—" },
    { label: "Last reboot", value: fmt(meta.lastReboot) },
    { label: "Reboot required", value: meta.rebootRequired == null ? "—" : meta.rebootRequired ? "Yes" : "No" },
    { label: "Warranty", value: meta.warrantyDate ?? "—" },
    { label: "Software", value: meta.softwareStatus ?? "—" },
    { label: "Make / model", value: [meta.manufacturer, meta.model].filter(Boolean).join(" ") || "—" },
    { label: "Serial", value: meta.serial ?? "—" },
    { label: "Agent version", value: meta.agentVersion ?? "—" },
    { label: "Assigned to", value: health.user ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <DeviceHealthCard device={health} openAlerts={alerts.filter((a) => !a.resolved).map((a) => a.message)} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Device" />
          <dl className="space-y-1 px-4 py-3.5 text-sm">
            {metaItems.map((m) => (
              <div key={m.label} className="flex justify-between gap-4">
                <dt className="text-muted">{m.label}</dt>
                <dd className="text-right font-medium text-ink-2">{m.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Patch trend" />
          <div className="px-4 py-3.5">
            <Sparkline values={trend.map((t) => t.patchPct ?? NaN)} width={220} height={48} />
            <p className="mt-2 text-xs text-muted">
              {trend.length} report{trend.length === 1 ? "" : "s"} on record
            </p>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Drives" />
        <table className="w-full text-sm">
          <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Drive</th>
              <th className="px-4 py-2.5 font-semibold">Size (GB)</th>
              <th className="px-4 py-2.5 font-semibold">Used</th>
            </tr>
          </thead>
          <tbody>
            {drives.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-muted">No drive data.</td>
              </tr>
            ) : (
              drives.map((d, i) => (
                <tr key={`${d.drive}-${i}`} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{d.drive}</td>
                  <td className="px-4 py-2.5 text-muted">{d.sizeGb === null ? "—" : Math.round(d.sizeGb)}</td>
                  <td className={`px-4 py-2.5 ${d.usedPct !== null && d.usedPct >= 90 ? "font-medium text-brand" : "text-muted"}`}>
                    {d.usedPct === null ? "—" : `${Math.round(d.usedPct)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <DeviceAlerts alerts={alerts} />
    </div>
  );
}
