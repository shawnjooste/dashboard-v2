import Link from "next/link";
import { getSecurityOverview } from "@/lib/views/security";
import { SEVERITY_ORDER } from "@/lib/security/rollup";
import { Card, CardHeader } from "@/components/ui";

const TONE: Record<string, string> = {
  critical: "bg-brand-tint text-brand",
  high: "bg-warn-tint text-warn-ink",
  medium: "bg-line-soft text-ink-2",
  low: "bg-line-soft text-ink-3",
  info: "bg-line-soft text-faint",
};

/** Staff-only: this client's open security findings at a glance. Reads the
 *  same rollup the SOC console uses, so the numbers always agree. */
export async function SecuritySection({ clientId }: { clientId: string }) {
  const overview = await getSecurityOverview();
  const mine = overview.byClient.find((c) => c.clientId === clientId);
  const open = mine ? SEVERITY_ORDER.reduce((n, s) => n + (mine.counts[s] ?? 0), 0) : 0;

  return (
    <Card>
      <CardHeader title="Security" count={open} />
      {!mine || open === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No open security findings.</p>
      ) : (
        <div className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.filter((s) => (mine.counts[s] ?? 0) > 0).map((s) => (
              <span
                key={s}
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize ${TONE[s]}`}
              >
                {mine.counts[s]} {s}
              </span>
            ))}
            <Link
              href={`/admin/security?client=${clientId}`}
              className="ml-auto text-[13px] font-semibold text-ink-3 hover:text-brand"
            >
              View all →
            </Link>
          </div>
          <ul className="mt-3 space-y-1.5">
            {mine.topItems.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-sm">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${TONE[e.severity]}`}
                >
                  {e.severity}
                </span>
                <span className="min-w-0 text-ink">{e.title}</span>
                {e.entityLabel && <span className="shrink-0 text-xs text-faint">{e.entityLabel}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
