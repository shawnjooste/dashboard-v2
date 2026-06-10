import type { FleetSummary } from "@/lib/views/health";

export function SummaryStrip({ summary }: { summary: FleetSummary }) {
  const items = [
    { label: "Devices", value: summary.total },
    { label: "Need attention", value: summary.needsAttention },
    { label: "Fleet patched", value: summary.fleetPatchPct === null ? "—" : `${summary.fleetPatchPct}%` },
    { label: "AV off", value: summary.avOff },
    { label: "Disks ≥90%", value: summary.diskFull },
    { label: "Open alerts", value: summary.openAlerts },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-2xl font-semibold">{it.value}</div>
          <div className="text-xs text-gray-500">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
