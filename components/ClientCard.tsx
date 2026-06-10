import Link from "next/link";
import type { ClientSummary } from "@/lib/views/clients";

export function ClientCard({ client }: { client: ClientSummary }) {
  const s = client.summary;
  return (
    <Link
      href={`/admin/clients/${client.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{client.name}</span>
        <span className={`text-sm font-semibold ${s.needsAttention ? "text-red-600" : "text-green-600"}`}>
          {s.needsAttention ? `${s.needsAttention} need attention` : "All healthy"}
        </span>
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {s.total} devices · {s.fleetPatchPct === null ? "—" : `${s.fleetPatchPct}%`} patched · {s.openAlerts} alerts
      </div>
    </Link>
  );
}
