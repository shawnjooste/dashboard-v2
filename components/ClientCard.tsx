import Link from "next/link";
import type { ClientSummary } from "@/lib/views/clients";

export function ClientCard({ client }: { client: ClientSummary }) {
  const s = client.summary;
  return (
    <Link
      href={`/admin/clients/${client.id}`}
      className="block rounded-lg border border-line bg-card p-4 transition-shadow hover:border-faint hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-ink">{client.name}</span>
        <span className={`text-[13px] font-semibold ${s.needsAttention ? "text-brand" : "text-good"}`}>
          {s.needsAttention ? `${s.needsAttention} need attention` : "All healthy"}
        </span>
      </div>
      <div className="mt-2 text-xs text-muted">
        {s.total} devices · {s.fleetPatchPct === null ? "—" : `${s.fleetPatchPct}%`} patched · {s.openAlerts} alerts
      </div>
    </Link>
  );
}
