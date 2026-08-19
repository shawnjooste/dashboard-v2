import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { Card, CardHeader, PageHeader, StatCard, StatGrid, StatusPill, type Health } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { gwfShare, routerCell, stormVerdict } from "@/lib/ned-helpers";

type StormRow = Database["public"]["Tables"]["ned_storm_watch"]["Row"];

const nf = new Intl.NumberFormat("en-GB");

/** status → tone, matching the loop's thresholds (>100 / 20–100 / <20 ARP/s).
 *  The DB row is authoritative — nothing here re-derives status. */
const STATUS_TONE: Record<string, Health> = { active: "bad", improving: "warn", cleared: "good" };

const VERDICT: Record<string, { label: string; wrap: string; dot: string }> = {
  active: { label: "Storm ACTIVE", wrap: "bg-brand-tint text-brand", dot: "bg-brand" },
  improving: { label: "Storm improving", wrap: "bg-warn-tint text-warn-ink", dot: "bg-warn" },
  cleared: { label: "Storm cleared", wrap: "bg-good-tint text-good", dot: "bg-good-dot" },
};

const BAR_FILL: Record<string, string> = {
  active: "var(--color-brand)",
  improving: "var(--color-warn)",
  cleared: "var(--color-good-dot)",
};

/** Dependency-free column chart of ARP/s per capture, oldest → newest, bars
 *  coloured by the row's own status. Dashed rules mark the loop's thresholds. */
function TrendChart({ rows }: { rows: StormRow[] }) {
  const W = 720;
  const H = 120;
  const max = Math.max(...rows.map((r) => r.arp_per_sec), 120); // keep the 100 line on-chart
  const step = W / rows.length;
  const barW = Math.max(1, step - Math.max(1, step * 0.15));
  const y = (v: number) => H - (v / max) * (H - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-28 w-full" role="img" aria-label="ARP per second per capture">
      {[100, 20].map((t) => (
        <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="4 4" />
      ))}
      {rows.map((r, i) => {
        const h = Math.max(2, (r.arp_per_sec / max) * (H - 6));
        return (
          <rect
            key={r.id}
            x={i * step + (step - barW) / 2}
            y={H - h}
            width={barW}
            height={h}
            rx={1}
            fill={BAR_FILL[r.status] ?? "var(--color-faint)"}
          />
        );
      })}
    </svg>
  );
}

export default async function NedPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ned_storm_watch")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(168);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const latest = rows[0];
  const chrono = [...rows].reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        title="NED network watch"
        subtitle="Steenberg broadcast-storm watch — hourly capture stats written by the NED loop. Status comes from the loop's own thresholds; this page only renders it."
      />

      {!latest ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            Watch not reporting — no capture rows yet. The hourly loop runs in the NED session on Shawn's Mac.
          </p>
        </Card>
      ) : (
        <>
          {/* Verdict banner from the latest capture — neutral when the watch has gone quiet
              (the loop runs on Shawn's Mac and has no heartbeat; an old status must not
              render as a confident current one). */}
          {(() => {
            const verdict = stormVerdict(latest.captured_at, latest.status, Date.now());
            if (verdict.kind === "stale") {
              return (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-line-soft px-4 py-3.5 text-ink-2">
                  <span className="flex items-center gap-2 text-[15px] font-semibold">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-faint" />
                    Watch stale — last capture {verdict.hoursAgo}h ago
                  </span>
                  <span className="text-sm">
                    was: {latest.status} at {latest.arp_per_sec.toFixed(1)} ARP/s
                  </span>
                  <span className="ml-auto text-[12.5px] font-medium">
                    Measured {fmtDateTime(latest.captured_at)} SAST
                  </span>
                </div>
              );
            }
            const v = VERDICT[verdict.status] ?? {
              label: `Status ${verdict.status}`,
              wrap: "bg-line-soft text-ink-2",
              dot: "bg-faint",
            };
            return (
              <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-4 py-3.5 ${v.wrap}`}>
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${v.dot}`} />
                  {v.label}
                </span>
                <span className="text-sm font-semibold">{latest.arp_per_sec.toFixed(1)} ARP/s</span>
                <span className="ml-auto text-[12.5px] font-medium">
                  Measured {fmtDateTime(latest.captured_at)} SAST
                </span>
              </div>
            );
          })()}

          {/* Latest capture metrics */}
          <StatGrid>
            <StatCard
              title="ARP rate"
              left={{
                label: "ARP/s",
                value: latest.arp_per_sec.toFixed(1),
                foot: `${nf.format(latest.arp_frames)} ARP in ${latest.duration_secs}s`,
              }}
              right={{
                label: "From GWF router",
                value:
                  gwfShare(latest.arp_from_gwf, latest.arp_frames) != null
                    ? `${gwfShare(latest.arp_from_gwf, latest.arp_frames)}%`
                    : "—",
                foot: `${nf.format(latest.arp_from_gwf)} of ${nf.format(latest.arp_frames)} ARP frames`,
              }}
            />
            <StatCard
              title="Storm reach"
              left={{
                label: "Dead /22 targets",
                value: nf.format(latest.distinct_targets),
                foot: "distinct IPs swept in 102.130.236.0/22",
              }}
              right={{
                label: "Broadcast share",
                value: `${latest.broadcast_pct.toFixed(1)}%`,
                foot: "of all frames captured",
              }}
            />
            <StatCard
              title="Line health"
              left={{
                label: "TCP retransmissions",
                value: nf.format(latest.tcp_retrans),
                foot: `in ${latest.duration_secs}s window`,
              }}
              right={{
                label: "Routers",
                value: routerCell(latest.bgp1_status, latest.steenberg_status).value,
                foot: `BGP1 ${latest.bgp1_status} · Steenberg ${latest.steenberg_status}`,
                footTone:
                  routerCell(latest.bgp1_status, latest.steenberg_status).tone === "bad"
                    ? "brand"
                    : routerCell(latest.bgp1_status, latest.steenberg_status).tone === "good"
                      ? "good"
                      : "warn",
              }}
            />
          </StatGrid>

          {/* Trend */}
          <Card>
            <CardHeader
              title="ARP/s per capture"
              action={
                <span className="text-xs text-faint">active &gt;100 · improving 20–100 · cleared &lt;20</span>
              }
            />
            <div className="px-4 pb-4 pt-3">
              <TrendChart rows={chrono} />
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11.5px] text-faint">
                <span>{fmtDateTime(chrono[0].captured_at)} SAST</span>
                <span>peak (shown window) {Math.max(...rows.map((r) => r.arp_per_sec)).toFixed(1)} ARP/s</span>
                <span>{fmtDateTime(chrono[chrono.length - 1].captured_at)} SAST</span>
              </div>
            </div>
          </Card>

          {/* Every capture, newest first */}
          <Card>
            <CardHeader title="Captures" count={rows.length} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Time (SAST)</th>
                    <th className="px-4 py-2.5 font-semibold">Window</th>
                    <th className="px-4 py-2.5 font-semibold">ARP/s</th>
                    <th className="px-4 py-2.5 font-semibold">GWF ARP</th>
                    <th className="px-4 py-2.5 font-semibold">Targets</th>
                    <th className="px-4 py-2.5 font-semibold">Broadcast</th>
                    <th className="px-4 py-2.5 font-semibold">TCP retrans</th>
                    <th className="px-4 py-2.5 font-semibold">Routers</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const share = gwfShare(r.arp_from_gwf, r.arp_frames);
                    return (
                      <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-2">
                          {fmtDateTime(r.captured_at)}
                          {r.note && (
                            <div className="mt-0.5 max-w-[220px] truncate font-sans text-[11px] text-faint" title={r.note}>
                              {r.note}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-ink-3">{r.duration_secs}s</td>
                        <td className="px-4 py-2.5 font-semibold text-ink">{r.arp_per_sec.toFixed(1)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">
                          {nf.format(r.arp_from_gwf)}
                          {share != null && <span className="text-faint"> ({share}%)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{nf.format(r.distinct_targets)}</td>
                        <td className="px-4 py-2.5 text-ink-2">{r.broadcast_pct.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-ink-2">{nf.format(r.tcp_retrans)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-ink-3">
                          BGP1 {r.bgp1_status} · Steenberg {r.steenberg_status}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <StatusPill tone={STATUS_TONE[r.status] ?? "warn"} label={<span className="capitalize">{r.status}</span>} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Standing diagnosis — collapsed; the long-form context behind the numbers */}
      <details className="rounded-xl border border-line bg-[#FCFCFD] p-4">
        <summary className="cursor-pointer text-[13.5px] font-semibold text-ink-2">Standing diagnosis</summary>
        <div className="mt-3 max-w-[760px] space-y-3 text-sm text-ink-2">
          <p>ARP broadcast storm on the Steenberg site.</p>
          <p>
            <strong>Root cause:</strong> the GWF↔Steenberg backhaul is bridged at layer 2, so both sites share one
            flat 172.16.0.0/16 broadcast domain; the Great Westerford core router (102.130.236.1) is ARP-sweeping
            ~700 unassigned public IPs in 102.130.236.0/22 (inbound scan/DDoS to dead space) and every request
            floods across the backhaul into Steenberg — ~96% of frames reaching Steenberg are GWF broadcast. GWF
            feels nothing; Steenberg saturates.
          </p>
          <p>
            <strong>Fixes in motion:</strong> Andre deploying edge filters (drop inbound to unassigned public IPs);
            structural fix is routing the backhaul instead of bridging.
          </p>
          <p className="text-[12.5px] text-muted">
            Data source: hourly 150s tshark capture on webinatortoo (Steenberg LAN) + LibreNMS checks, written by
            the NED Claude session.
          </p>
        </div>
      </details>
    </div>
  );
}
