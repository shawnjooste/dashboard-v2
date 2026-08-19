import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import { Card, CardHeader, PageHeader, StatCard, StatGrid, StatusPill, type Health } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import {
  asList,
  fmtBytes,
  fmtUptime,
  gwfShare,
  parseNedDetails,
  routerCell,
  safeNum,
  safeStr,
  stormVerdict,
  type NedDetails,
  type NedRouterSnap,
} from "@/lib/ned-helpers";

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

/* ------------------------------------------------------------------ */
/* Latest-capture deep dive — rendered only when the row carries the   */
/* rich `details` jsonb (migration 0094). Every section tolerates any  */
/* missing sub-key: old rows and partial payloads must never crash it. */
/* ------------------------------------------------------------------ */

/** "—" for anything that isn't a finite number, else grouped digits. */
function fmtCount(v: unknown): string {
  const n = safeNum(v);
  return n == null ? "—" : nf.format(n);
}

/** Compact label-over-value stats, the deep-dive equivalent of StatCard cells. */
function MiniStats({
  items,
}: {
  items: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{it.label}</div>
          <div className={`mt-1 text-lg font-bold leading-none ${it.tone === "warn" ? "text-warn" : "text-ink"}`}>
            {it.value}
          </div>
          {it.sub != null && <div className="mt-1 text-[11px] text-faint">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** One labelled horizontal bar; width is the caller's percentage of its scale. */
function BarRow({ label, widthPct, detail }: { label: string; widthPct: number; detail: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate font-mono text-xs text-ink-2" title={label}>
        {label}
      </span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-ink-3"
          style={{ width: `${Math.min(100, Math.max(widthPct, 0.75))}%` }}
        />
      </div>
      <span className="w-32 shrink-0 text-right text-xs text-ink-2">{detail}</span>
    </div>
  );
}

function ProtocolMixCard({ d }: { d: NedDetails }) {
  const rows = asList(d.protocols)
    .map((p) => ({ name: safeStr(p?.name) ?? "?", frames: safeNum(p?.frames) ?? 0 }))
    .sort((a, b) => b.frames - a.frames);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.frames, 0);
  return (
    <Card>
      <CardHeader
        title="Protocol mix"
        action={<span className="text-xs text-faint">{nf.format(total)} frames classified</span>}
      />
      <div className="space-y-2 px-4 py-3.5">
        {rows.map((r, i) => {
          const pct = total > 0 ? (r.frames / total) * 100 : 0;
          return (
            <BarRow
              key={`${r.name}-${i}`}
              label={r.name}
              widthPct={pct}
              detail={
                <>
                  {nf.format(r.frames)} <span className="text-faint">({pct.toFixed(1)}%)</span>
                </>
              }
            />
          );
        })}
      </div>
    </Card>
  );
}

const SUB_TH = "px-4 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint";
const SUB_TD = "px-4 py-2 text-ink-2";

function ArpAnatomyCard({ d }: { d: NedDetails }) {
  const a = d.arp;
  if (a == null || typeof a !== "object") return null;
  const rates = d.rates ?? undefined;
  const perSec = (v: unknown): string | undefined => {
    const n = safeNum(v);
    return n == null ? undefined : `${n.toFixed(1)}/s`;
  };
  const retry = safeNum(a.retry_ratio);
  const senders = asList(a.top_senders).map((s) => ({
    mac: safeStr(s?.mac) ?? "—",
    ip: safeStr(s?.ip) ?? "—",
    count: fmtCount(s?.count),
  }));
  const targets = asList(a.top_targets).map((t) => ({
    ip: safeStr(t?.ip) ?? "—",
    count: fmtCount(t?.count),
  }));
  const subnets = asList(a.target_subnets)
    .map((s) => ({ subnet: safeStr(s?.subnet) ?? "?", count: safeNum(s?.count) ?? 0 }))
    .sort((x, y) => y.count - x.count);
  const subnetMax = Math.max(...subnets.map((s) => s.count), 1);
  return (
    <Card>
      <CardHeader title="ARP anatomy" />
      <MiniStats
        items={[
          { label: "Requests", value: fmtCount(a.requests) },
          { label: "Replies", value: fmtCount(a.replies) },
          { label: "From GWF", value: fmtCount(a.from_gwf), sub: perSec(rates?.gwf_arp_per_sec) },
          { label: "From others", value: fmtCount(a.from_others), sub: perSec(rates?.non_gwf_arp_per_sec) },
          { label: "Retry ratio", value: retry == null ? "—" : retry.toFixed(2) },
          { label: "Targets in /22", value: fmtCount(a.distinct_targets_22) },
          { label: "Targets overall", value: fmtCount(a.distinct_targets_all) },
        ]}
      />
      {(senders.length > 0 || targets.length > 0) && (
        <div className="grid grid-cols-1 border-t border-line-soft sm:grid-cols-2">
          <div className="border-b border-line-soft sm:border-b-0 sm:border-r">
            <div className="px-4 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              Top senders
            </div>
            {senders.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">None recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={SUB_TH}>MAC</th>
                    <th className={SUB_TH}>IP</th>
                    <th className={`${SUB_TH} text-right`}>ARPs</th>
                  </tr>
                </thead>
                <tbody>
                  {senders.map((s, i) => (
                    <tr key={`${s.mac}-${i}`} className="border-t border-line-soft">
                      <td className={`${SUB_TD} font-mono text-xs`}>{s.mac}</td>
                      <td className={`${SUB_TD} font-mono text-xs`}>{s.ip}</td>
                      <td className={`${SUB_TD} text-right font-semibold text-ink`}>{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div className="px-4 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              Top targets
            </div>
            {targets.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">None recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={SUB_TH}>IP</th>
                    <th className={`${SUB_TH} text-right`}>ARPs</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t, i) => (
                    <tr key={`${t.ip}-${i}`} className="border-t border-line-soft">
                      <td className={`${SUB_TD} font-mono text-xs`}>{t.ip}</td>
                      <td className={`${SUB_TD} text-right font-semibold text-ink`}>{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {subnets.length > 0 && (
        <div className="border-t border-line-soft px-4 py-3.5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
            Target subnet spread
          </div>
          <div className="mt-2 space-y-1.5">
            {subnets.map((s, i) => (
              <BarRow
                key={`${s.subnet}-${i}`}
                label={s.subnet}
                widthPct={(s.count / subnetMax) * 100}
                detail={nf.format(s.count)}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function TopTalkersCard({ d }: { d: NedDetails }) {
  const talkers = asList(d.top_talkers).map((t) => ({
    ip: safeStr(t?.ip) ?? "—",
    tx: fmtBytes(t?.tx_bytes),
    rx: fmtBytes(t?.rx_bytes),
    total: fmtBytes(t?.total_bytes),
  }));
  if (talkers.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Top talkers" count={talkers.length} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line-soft">
            <tr>
              <th className={SUB_TH}>IP</th>
              <th className={`${SUB_TH} text-right`}>TX</th>
              <th className={`${SUB_TH} text-right`}>RX</th>
              <th className={`${SUB_TH} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {talkers.map((t, i) => (
              <tr key={`${t.ip}-${i}`} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                <td className={`${SUB_TD} font-mono text-xs`}>{t.ip}</td>
                <td className={`${SUB_TD} whitespace-nowrap text-right`}>{t.tx}</td>
                <td className={`${SUB_TD} whitespace-nowrap text-right`}>{t.rx}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-ink">{t.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TcpExpertCard({ d }: { d: NedDetails }) {
  const t = d.tcp;
  if (t == null || typeof t !== "object") return null;
  const cells: [string, number | null][] = [
    ["Retransmissions", safeNum(t.retrans)],
    ["Dup ACKs", safeNum(t.dup_ack)],
    ["Resets", safeNum(t.resets)],
    ["Zero window", safeNum(t.zero_window)],
    ["Out of order", safeNum(t.out_of_order)],
  ];
  const known = cells.filter(([, v]) => v != null);
  if (known.length === 0) return null;
  const clean = known.every(([, v]) => v === 0);
  return (
    <Card>
      <CardHeader title="TCP expert" />
      {clean ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-good-dot" />
          Transport clean — no retransmissions, resets or window stalls in this window.
        </p>
      ) : (
        <MiniStats
          items={cells.map(([label, v]) => ({
            label,
            value: v == null ? "—" : nf.format(v),
            tone: v != null && v > 0 ? ("warn" as const) : undefined,
          }))}
        />
      )}
    </Card>
  );
}

function L2Card({ d }: { d: NedDetails }) {
  const l2 = d.l2;
  if (l2 == null || typeof l2 !== "object") return null;
  const root = safeStr(l2.stp_root);
  return (
    <Card>
      <CardHeader title="L2 & control plane" />
      <MiniStats
        items={[
          { label: "Unique MACs", value: fmtCount(l2.unique_macs) },
          { label: "Broadcast", value: fmtCount(l2.broadcast_frames) },
          { label: "Multicast", value: fmtCount(l2.multicast_frames) },
          { label: "STP BPDUs", value: fmtCount(l2.stp_bpdus) },
          { label: "MNDP frames", value: fmtCount(l2.mndp_frames) },
        ]}
      />
      {root && (
        <p className="border-t border-line-soft px-4 py-2.5 text-xs text-ink-2">
          STP root bridge <span className="font-mono">{root}</span>
        </p>
      )}
    </Card>
  );
}

function IssuesCard({ d }: { d: NedDetails }) {
  const iss = d.issues;
  if (iss == null || typeof iss !== "object") return null;
  const rows: { label: string; detail: ReactNode; ok: boolean }[] = [];
  if (iss.dup_ip_10_0_0_1_macs != null) {
    const macs = asList(iss.dup_ip_10_0_0_1_macs)
      .map((m) => safeStr(m))
      .filter((m): m is string => m != null);
    rows.push({
      label: "Duplicate IP 10.0.0.1 claimants",
      detail:
        macs.length === 0 ? (
          "none"
        ) : (
          <span className="font-mono text-xs" title={macs.join(", ")}>
            {macs.join(" · ")}
          </span>
        ),
      ok: macs.length === 0,
    });
  }
  const numeric: [string, unknown][] = [
    ["ARPs for dead gateway 192.168.5.1", iss.arps_for_192_168_5_1],
    ["ICMP errors", iss.icmp_errors],
    ["DNS errors", iss.dns_errors],
    ["DHCP discovers", iss.dhcp_discovers],
  ];
  for (const [label, v] of numeric) {
    const n = safeNum(v);
    if (n == null) continue; // not measured this capture — no row, no false "ok"
    rows.push({ label, detail: nf.format(n), ok: n === 0 });
  }
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Known issues tracker" />
      <div className="divide-y divide-line-soft">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <StatusPill tone={r.ok ? "good" : "warn"} label={r.ok ? "ok" : "warn"} />
            <span className="text-ink-2">{r.label}</span>
            <span className="ml-auto text-right font-semibold text-ink">{r.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RouterBlock({ name, snap }: { name: string; snap: NedRouterSnap | null | undefined }) {
  if (snap == null || typeof snap !== "object") return null;
  const status = safeStr(snap.status) ?? "unknown";
  const tone: Health = status === "up" ? "good" : status === "down" ? "bad" : "warn";
  const polled = safeStr(snap.last_polled);
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <StatusPill tone={tone} label={<span className="capitalize">{status}</span>} />
      </div>
      <div className="mt-1 text-xs text-faint">
        up {fmtUptime(snap.uptime)} · {polled ? `polled ${fmtDateTime(polled)} SAST` : "poll time unknown"}
      </div>
    </div>
  );
}

function MonitoringCard({ d }: { d: NedDetails }) {
  const mon = d.librenms;
  if (mon == null || typeof mon !== "object") return null;
  const hasRouters = mon.bgp1 != null || mon.steenberg != null;
  if (!hasRouters && mon.active_alerts == null) return null;
  const alerts = asList(mon.active_alerts).filter((a) => a != null && typeof a === "object");
  return (
    <Card>
      <CardHeader title="Monitoring snapshot" action={<span className="text-xs text-faint">LibreNMS</span>} />
      {hasRouters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-line-soft">
          <RouterBlock name="BGP1" snap={mon.bgp1} />
          <RouterBlock name="Steenberg" snap={mon.steenberg} />
        </div>
      )}
      {mon.active_alerts != null && (
        <div className="border-t border-line-soft px-4 py-3">
          {alerts.length === 0 ? (
            <p className="text-[12.5px] text-muted">No active LibreNMS alerts.</p>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map((a, i) => {
                const since = safeStr(a?.since);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-warn" />
                    <span className="font-medium text-warn-ink">{safeStr(a?.rule) ?? "Unnamed rule"}</span>
                    <span className="text-muted">
                      device {a?.device_id ?? "?"}
                      {since ? ` · since ${fmtDateTime(since)} SAST` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function CaptureMetaLine({ d }: { d: NedDetails }) {
  const c = d.capture;
  if (c == null || typeof c !== "object") return null;
  const bits: string[] = [];
  const host = safeStr(c.host);
  if (host) bits.push(`host ${host}`);
  const iface = safeStr(c.interface);
  if (iface) bits.push(`interface ${iface}`);
  const snaplen = safeNum(c.snaplen);
  if (snaplen != null) bits.push(`snaplen ${nf.format(snaplen)} B`);
  const pcap = safeNum(c.pcap_bytes);
  if (pcap != null) bits.push(`pcap ${fmtBytes(pcap)}`);
  const ended = safeStr(c.ended_utc);
  if (ended) bits.push(`ended ${fmtDateTime(ended)} SAST`);
  if (bits.length === 0) return null;
  return <p className="text-[12.5px] text-muted">Capture: {bits.join(" · ")}</p>;
}

/** The whole deep-dive region; each section skips itself when its key is absent. */
function DeepDive({ d, capturedAt }: { d: NedDetails; capturedAt: string }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">Latest capture — deep dive</h2>
        <span className="text-xs text-faint">
          full breakdown of the {fmtDateTime(capturedAt)} SAST capture
        </span>
      </div>
      <ProtocolMixCard d={d} />
      <ArpAnatomyCard d={d} />
      <TopTalkersCard d={d} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <TcpExpertCard d={d} />
        <L2Card d={d} />
      </div>
      <IssuesCard d={d} />
      <MonitoringCard d={d} />
      <CaptureMetaLine d={d} />
    </section>
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

          {/* Latest capture — deep dive; only rows written after migration 0094
              carry `details`, and any sub-key may be absent, so the whole region
              is gated on a successful narrow parse. */}
          {(() => {
            const d = parseNedDetails(latest.details);
            return d ? <DeepDive d={d} capturedAt={latest.captured_at} /> : null;
          })()}

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
                          {r.details != null && (
                            <span
                              className="ml-1.5 inline-block h-[5px] w-[5px] rounded-full bg-faint align-middle"
                              title="Deep-dive details captured"
                            />
                          )}
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
