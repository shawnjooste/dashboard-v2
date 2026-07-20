import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getClientNetwork, deviceLabel, type Overall } from "@/lib/views/network";
import { PageHeader } from "@/components/ui";

const OVERALL: Record<Overall, { label: string; blurb: string; dot: string; text: string; tint: string }> = {
  healthy: { label: "Healthy", blurb: "Everything's online.", dot: "#15803D", text: "text-good", tint: "bg-good-tint" },
  issues: { label: "Issues", blurb: "Some equipment needs attention.", dot: "#B45309", text: "text-warn", tint: "bg-warn-tint" },
  down: { label: "Down", blurb: "Your network is offline — we're on it.", dot: "#D7141C", text: "text-brand", tint: "bg-brand-tint" },
};

const KIND_ORDER: Record<string, number> = { gateway: 0, switch: 1, ap: 2, other: 3 };
const STATUS_DOT: Record<string, string> = { online: "#15803D", offline: "#D7141C", alerting: "#B45309" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10).split("-");
  return `${d[2]} ${MONTHS[Number(d[1]) - 1]}, ${iso.slice(11, 16)}`;
}

export default async function NetworkPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "network")) redirect("/");
  if (me.profile.role !== "client_manager") redirect("/");

  const net = await getClientNetwork();
  const stale = net?.lastSyncAt ? Date.now() - Date.parse(net.lastSyncAt) > 36 * 3600 * 1000 : false;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/" className="underline underline-offset-2 hover:text-ink">
            Account home
          </Link>
        }
        title="Network"
        subtitle="Your office network — live status and connected equipment."
      />

      {!net ? (
        <div className="rounded-xl border border-line bg-card px-6 py-12 text-center">
          <div className="text-[15px] font-semibold text-ink-3">Network monitoring isn&rsquo;t connected yet</div>
          <div className="mt-1.5 text-[13.5px] text-faint">Once we link your gear, you&rsquo;ll see live status here.</div>
        </div>
      ) : (
        <>
          {stale && (
            <div className="flex items-center gap-2 rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-[13px] font-medium text-warn-ink">
              <span aria-hidden>⚠</span> Data may be stale — last synced {stamp(net.lastSyncAt)}.
            </div>
          )}

          {/* Status hero */}
          <div className={`flex items-center gap-4 rounded-xl border border-line ${OVERALL[net.overall].tint} px-5 py-4`}>
            <span className="flex h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: OVERALL[net.overall].dot }} />
            <div className="min-w-0">
              <div className={`text-[17px] font-bold ${OVERALL[net.overall].text}`}>{OVERALL[net.overall].label}</div>
              <div className="text-[13.5px] text-ink-2">
                {OVERALL[net.overall].blurb} {net.onlineCount} of {net.deviceCount} devices online
                {net.clientCount > 0 ? ` · ${net.clientCount} people connected` : ""}.
              </div>
            </div>
            <span className="ml-auto hidden shrink-0 text-right text-xs text-faint sm:block">
              as of {stamp(net.lastSyncAt)}
            </span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: "Devices online", v: `${net.onlineCount}/${net.deviceCount}` },
              { k: "People connected", v: net.clientCount > 0 ? String(net.clientCount) : "—" },
              { k: "Uptime", v: net.uptimePct != null ? `${net.uptimePct}%` : "—" },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-line bg-card px-4 py-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3px] text-muted">{s.k}</div>
                <div className="mt-1.5 text-[24px] font-bold leading-none text-ink">{s.v}</div>
              </div>
            ))}
          </div>

          {/* Equipment */}
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <div className="border-b border-line-soft bg-[#FCFCFD] px-5 py-[11px] text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">
              Equipment ({net.deviceCount})
            </div>
            {[...net.devices]
              .sort((a, b) => (KIND_ORDER[a.kind ?? "other"] ?? 3) - (KIND_ORDER[b.kind ?? "other"] ?? 3))
              .map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_DOT[d.status ?? ""] ?? "#94A3B8" }}
                    title={d.status ?? "unknown"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-ink">{deviceLabel(d)}</div>
                    <div className="truncate text-xs text-faint">
                      {[d.model, d.ip].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium capitalize text-ink-3">{d.status ?? "unknown"}</span>
                </div>
              ))}
          </div>

          <p className="text-xs text-faint">
            Updated once daily. Status reflects the last sync ({stamp(net.lastSyncAt)}).
          </p>
        </>
      )}
    </div>
  );
}
