import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSecurityEvents } from "@/lib/views/security";
import { setTriage } from "@/lib/actions/security";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const KINDS = ["activity", "posture"] as const;
const TRIAGE = ["new", "acknowledged", "escalated", "dismissed"] as const;
const FIELD = "rounded-lg border border-line bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-faint";

const SEV_TONE: Record<string, string> = {
  critical: "bg-brand-tint text-brand",
  high: "bg-warn-tint text-warn-ink",
  medium: "bg-line-soft text-ink-2",
  low: "bg-line-soft text-ink-3",
  info: "bg-line-soft text-faint",
};

const fmt = (ts: string) => ts.replace("T", " ").slice(0, 16);

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; kind?: string; client?: string; triage?: string; open?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const params = await searchParams;
  const severity = SEVERITIES.includes(params.severity as (typeof SEVERITIES)[number]) ? params.severity : undefined;
  const kind = KINDS.includes(params.kind as (typeof KINDS)[number]) ? params.kind : undefined;
  const triage = TRIAGE.includes(params.triage as (typeof TRIAGE)[number]) ? params.triage : undefined;
  const openOnly = params.open === "1";
  const clientId = params.client || undefined;

  const { events, capped, totals } = await getSecurityEvents({ severity, kind, clientId, triage, openOnly });
  const clientsInFeed = [...new Map(events.map((e) => [e.clientId, e.clientName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      severity: severity ?? "",
      kind: kind ?? "",
      client: clientId ?? "",
      triage: triage ?? "",
      open: openOnly ? "1" : "",
      ...over,
    });
    for (const k of [...p.keys()]) if (!p.get(k)) p.delete(k);
    const s = p.toString();
    return `/admin/security${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-[12.5px] font-semibold ${active ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        subtitle="The normalized security stream across every client and source — alerts, exposures, and Rocking's triage state."
      />

      {/* Severity summary for the current filter */}
      <div className="flex flex-wrap items-center gap-2">
        {SEVERITIES.map((s) => (
          <span key={s} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold capitalize ${SEV_TONE[s]}`}>
            {s}: {totals[s] ?? 0}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ severity: "" })} className={chip(!severity)}>
          All severities
        </Link>
        {SEVERITIES.map((s) => (
          <Link key={s} href={qs({ severity: s })} className={chip(severity === s)}>
            <span className="capitalize">{s}</span>
          </Link>
        ))}
        <span className="mx-1 text-line">|</span>
        <Link href={qs({ kind: "" })} className={chip(!kind)}>
          All kinds
        </Link>
        {KINDS.map((k) => (
          <Link key={k} href={qs({ kind: k })} className={chip(kind === k)}>
            <span className="capitalize">{k}</span>
          </Link>
        ))}
        <Link href={qs({ open: openOnly ? "" : "1" })} className={chip(openOnly)}>
          Open only
        </Link>
        <span className="mx-1 text-line">|</span>
        {TRIAGE.map((t) => (
          <Link key={t} href={qs({ triage: triage === t ? "" : t })} className={chip(triage === t)}>
            <span className="capitalize">{t}</span>
          </Link>
        ))}
        <form className="ml-auto" action="/admin/security" method="get">
          <select name="client" defaultValue={clientId ?? ""} className={FIELD}>
            <option value="">All clients</option>
            {clientsInFeed.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button className="ml-2 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-black">
            Filter
          </button>
        </form>
      </div>

      {capped && (
        <p className="text-[13px] text-muted">Showing the most recent 500 — narrow the filters for a complete view.</p>
      )}

      <Card>
        <CardHeader title="Events" count={events.length} />
        {events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing matches this filter.</p>
        ) : (
          <ul>
            {events.map((e) => {
              const save = setTriage.bind(null, e.id);
              return (
                <li key={e.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${SEV_TONE[e.severity]}`}>
                      {e.severity}
                    </span>
                    <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                      {e.kind}
                    </span>
                    <span className="shrink-0 text-[11px] text-faint">{e.source}</span>
                    <span className="min-w-0 text-sm font-medium text-ink">{e.title}</span>
                    {e.kind === "posture" && (
                      <span className={`text-[11px] font-medium ${e.resolved ? "text-good" : "text-warn-ink"}`}>
                        {e.resolved ? "resolved" : "open"}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-xs text-faint">{fmt(e.occurredAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    <span>{e.clientName}</span>
                    {e.entityLabel && <span>· {e.entityLabel}</span>}
                    {e.detail && <span className="truncate">· {e.detail}</span>}
                    <form action={save} className="ml-auto flex shrink-0 items-center gap-1.5">
                      <select name="triage_state" defaultValue={e.triageState} className={FIELD}>
                        {TRIAGE.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input name="triage_note" placeholder="Note" className={`${FIELD} w-36`} />
                      <button className="rounded-lg bg-ink px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-black">
                        Save
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
