import type { FleetSummary } from "@/lib/views/health";

export function SummaryStrip({ summary }: { summary: FleetSummary }) {
  const items: { label: string; value: number | string; alert?: boolean; warn?: boolean }[] = [
    { label: "Devices", value: summary.total },
    { label: "Need attention", value: summary.needsAttention, alert: summary.needsAttention > 0 },
    { label: "Fleet patched", value: summary.fleetPatchPct === null ? "—" : `${summary.fleetPatchPct}%` },
    { label: "AV off", value: summary.avOff, alert: summary.avOff > 0 },
    { label: "Disks ≥90%", value: summary.diskFull, warn: summary.diskFull > 0 },
    { label: "Open alerts", value: summary.openAlerts, warn: summary.openAlerts > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-line bg-card px-4 py-3">
          <div
            className={`text-2xl font-bold ${it.alert ? "text-brand" : it.warn ? "text-warn" : "text-ink"}`}
          >
            {it.value}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
