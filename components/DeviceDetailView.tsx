import type { DeviceDetail } from "@/lib/views/devices";
import { DeviceHealthCard } from "./DeviceHealthCard";
import { Sparkline } from "./Sparkline";

const fmt = (ts: string | null) => (ts ? ts.replace("T", " ").slice(0, 16) : "—");

export function DeviceDetailView({ detail }: { detail: DeviceDetail }) {
  const { health, meta, drives, alerts, trend } = detail;
  const metaItems = [
    { label: "Operating system", value: health.os ?? "—" },
    { label: "Last reboot", value: fmt(meta.lastReboot) },
    { label: "Make / model", value: [meta.manufacturer, meta.model].filter(Boolean).join(" ") || "—" },
    { label: "Serial", value: meta.serial ?? "—" },
    { label: "Agent version", value: meta.agentVersion ?? "—" },
    { label: "Assigned to", value: health.user ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <DeviceHealthCard device={health} />

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Device</h3>
          <dl className="space-y-1 text-sm">
            {metaItems.map((m) => (
              <div key={m.label} className="flex justify-between gap-4">
                <dt className="text-gray-500">{m.label}</dt>
                <dd className="text-right font-medium">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Patch trend</h3>
          <Sparkline values={trend.map((t) => t.patchPct ?? NaN)} width={220} height={48} />
          <p className="mt-2 text-xs text-gray-500">
            {trend.length} report{trend.length === 1 ? "" : "s"} on record
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Drives</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Drive</th>
                <th className="px-3 py-2">Size (GB)</th>
                <th className="px-3 py-2">Used</th>
              </tr>
            </thead>
            <tbody>
              {drives.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-gray-500">No drive data.</td>
                </tr>
              ) : (
                drives.map((d, i) => (
                  <tr key={`${d.drive}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{d.drive}</td>
                    <td className="px-3 py-2 text-gray-600">{d.sizeGb === null ? "—" : Math.round(d.sizeGb)}</td>
                    <td className={`px-3 py-2 ${d.usedPct !== null && d.usedPct >= 90 ? "text-red-600" : "text-gray-600"}`}>
                      {d.usedPct === null ? "—" : `${Math.round(d.usedPct)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Recent alerts ({alerts.length})
        </h3>
        {alerts.length === 0 ? (
          <p className="text-gray-500">No alerts on record.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a, i) => (
              <li key={i} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{a.message}</span>
                  <span className={`shrink-0 text-xs ${a.resolved ? "text-green-600" : "text-red-600"}`}>
                    {a.resolved ? "Resolved" : "Open"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {fmt(a.triggeredAt)}{a.priority ? ` · ${a.priority}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
