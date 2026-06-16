import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";
import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth, getFleetPatchTrend } from "@/lib/views/devices";
import { getSampleDeviceHealth, getSampleFleetPatchTrend, getSampleM365View } from "@/lib/views/sample";
import { summarize, type DeviceHealth } from "@/lib/views/health";
import { Sparkline } from "@/components/Sparkline";
import { SampleBanner } from "@/components/SampleBanner";
import { getM365View, type M365View } from "@/lib/views/m365";
import {
  getSupportScope,
  listConversationsByEmail,
  listRecentConversations,
  type TicketSummary,
} from "@/lib/freescout";
import { filterConversations } from "@/lib/freescout-scope";
import { DeviceHealthCard } from "@/components/DeviceHealthCard";
import {
  PageHeader,
  PrimaryLink,
  SecondaryLink,
  Card,
  CardHeader,
  StatCard,
  StatGrid,
  Denominator,
  type Health,
} from "@/components/ui";

const TICKET_TONE: Record<string, Health> = {
  active: "warn",
  pending: "bad",
  closed: "good",
};
const TICKET_LABEL: Record<string, string> = {
  active: "Open",
  pending: "Waiting on you",
  closed: "Resolved",
};

function deviceReason(d: DeviceHealth): string {
  if (d.flags.avOff) return "antivirus is off";
  if (d.flags.diskFull) return "disk is nearly full";
  if (d.flags.patchIssue) return "updates need attention";
  if (d.flags.openAlerts) return "has open alerts";
  return "needs attention";
}

export default async function AppHome() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  const path = resolveLandingPath({
    authenticated: true,
    role: me.profile.role,
    status: me.profile.status,
    hasClient: me.profile.client_id !== null,
    hasClaimedDevice: me.hasClaimedDevice,
  });
  if (path !== "/app") redirect(path);

  let devices = await getVisibleDeviceHealth();

  // ---------- client_member: their claimed machine ----------
  if (me.profile.role !== "client_manager") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My computer"
          subtitle="The current health of the computer linked to your account."
        />
        {devices.length === 0 ? (
          <p className="text-sm text-muted">No computer is linked to your account yet.</p>
        ) : (
          <div className="space-y-6">
            {devices.map((d) => (
              <div key={d.id} className="space-y-3">
                <DeviceHealthCard device={d} />
                <SecondaryLink href={`/devices/${d.id}`}>View details</SecondaryLink>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- client_manager: account home dashboard ----------
  const supabase = await createClient();
  const [clientRes, m365Res, ticketData, patchTrendRes] = await Promise.all([
    me.profile.client_id
      ? supabase.from("clients").select("name").eq("id", me.profile.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    me.profile.client_id
      ? getM365View(me.profile.client_id)
      : Promise.resolve<M365View | null>(null),
    loadTickets(),
    getFleetPatchTrend(),
  ]);
  const client = clientRes.data;
  let m365 = m365Res;
  let patchTrend = patchTrendRes;

  // Prospect preview: a client with no real data sees the sample (JoosteCo) set
  // behind a banner — Devices and M365 as a live sales demo.
  let devicesSample = false;
  let m365Sample = false;
  if (devices.length === 0) {
    devices = await getSampleDeviceHealth();
    patchTrend = await getSampleFleetPatchTrend();
    devicesSample = true;
  }
  if (!m365?.connected) {
    m365 = await getSampleM365View();
    m365Sample = true;
  }
  const sample = devicesSample || m365Sample;

  const summary = summarize(devices);
  const healthy = summary.total - summary.needsAttention;
  const attention = devices.filter((d) => d.needsAttention);
  const deviceList = [...attention, ...devices.filter((d) => !d.needsAttention)].slice(0, 5);

  const { tickets, ticketsOk } = ticketData;
  const openTickets = tickets.filter((t) => t.status !== "closed");
  const pendingTickets = tickets.filter((t) => t.status === "pending");
  const closedTickets = tickets.filter((t) => t.status === "closed");

  const m365On = !!m365?.connected;
  const pwOnly = m365?.passwordOnly.length ?? 0;
  const twoStepOn = m365 ? m365.activeLicensed - pwOnly : 0;
  const licTotals = (m365?.licenses ?? []).filter((l) => l.total !== null);
  const licUsed = licTotals.reduce((n, l) => n + (l.consumed ?? 0), 0);
  const licTotal = licTotals.reduce((n, l) => n + (l.total ?? 0), 0);
  const licSpare = Math.max(0, licTotal - licUsed);

  // Plain-language next steps, derived from live signals.
  const nextSteps: { label: string; href: string }[] = [];
  if (pendingTickets[0]) {
    nextSteps.push({
      label: `Reply to ticket #${pendingTickets[0].number} so we can finish the fix`,
      href: `/support/${pendingTickets[0].id}`,
    });
  }
  if (!devicesSample) {
    for (const d of attention.slice(0, 2)) {
      nextSteps.push({ label: `Check ${d.hostname} — ${deviceReason(d)}`, href: `/devices/${d.id}` });
    }
  }
  if (pwOnly > 0) {
    nextSteps.push({
      label: `${pwOnly} ${pwOnly === 1 ? "person still needs" : "people still need"} two-step sign-in`,
      href: "/m365",
    });
  }

  return (
    <div className="space-y-6">
      {sample && <SampleBanner />}
      <PageHeader
        breadcrumb="Account home"
        title={client?.name ?? "Your company"}
        action={<PrimaryLink href="/support/new">+ Raise a ticket</PrimaryLink>}
      />

      <h2 className="mt-8 text-base font-bold text-ink">Overview</h2>

      <StatGrid>
        <StatCard
          title="Support"
          href="/support"
          left={{
            label: "Open tickets",
            value: ticketsOk ? openTickets.length : "—",
            foot: !ticketsOk
              ? "support desk unreachable"
              : pendingTickets.length > 0
                ? `${pendingTickets.length} awaiting your reply`
                : "all being worked on",
            footTone: ticketsOk && pendingTickets.length > 0 ? "brand" : "muted",
          }}
          right={{
            label: "Resolved",
            value: ticketsOk ? closedTickets.length : "—",
            foot: "recent tickets",
          }}
        />
        <StatCard
          title="Computers"
          href="/devices"
          left={{
            label: "Healthy",
            value: (
              <>
                {healthy} <Denominator>/ {summary.total}</Denominator>
              </>
            ),
            foot:
              summary.needsAttention > 0
                ? `${summary.needsAttention} need${summary.needsAttention === 1 ? "s" : ""} attention`
                : "all healthy",
            footTone: summary.needsAttention > 0 ? "warn" : "good",
          }}
          right={{
            label: "Updates installed",
            value: summary.fleetPatchPct === null ? "—" : `${summary.fleetPatchPct}%`,
            extra:
              patchTrend.length >= 2 ? (
                <div className="mt-1">
                  <Sparkline values={patchTrend} width={120} height={28} />
                </div>
              ) : undefined,
            foot:
              summary.openAlerts > 0
                ? `${summary.openAlerts} open alert${summary.openAlerts === 1 ? "" : "s"}`
                : "no open alerts",
            footTone: summary.openAlerts > 0 ? "warn" : "good",
          }}
        />
        <StatCard
          title="Microsoft 365"
          href="/m365"
          left={{
            label: "Two-step sign-in on",
            value: m365On ? (
              <>
                {twoStepOn} <Denominator>/ {m365!.activeLicensed}</Denominator>
              </>
            ) : (
              "—"
            ),
            extra:
              m365On && m365!.trend.length >= 2 ? (
                <div className="mt-1">
                  <Sparkline values={m365!.trend} width={120} height={28} />
                </div>
              ) : undefined,
            foot: !m365On
              ? "not connected yet"
              : pwOnly > 0
                ? `${pwOnly} ${pwOnly === 1 ? "person" : "people"} to set up`
                : "everyone covered",
            footTone: m365On ? (pwOnly > 0 ? "warn" : "good") : "muted",
          }}
          right={{
            label: "Licences in use",
            value: !m365On ? "—" : licTotal > 0 ? (
              <>
                {licUsed} <Denominator>/ {licTotal}</Denominator>
              </>
            ) : (
              m365!.activeLicensed
            ),
            foot: m365On && licTotal > 0
              ? licSpare > 0
                ? `${licSpare} spare for new starters`
                : "all in use"
              : "licensed people",
          }}
        />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Support tickets */}
        <Card>
          <CardHeader title="Support tickets" count={ticketsOk ? tickets.length : "—"} href="/support" />
          {!ticketsOk ? (
            <p className="px-4 py-3.5 text-sm text-muted">
              The support desk is unreachable right now — your tickets are safe.
            </p>
          ) : tickets.length === 0 ? (
            <p className="px-4 py-3.5 text-sm text-muted">No tickets yet — all quiet.</p>
          ) : (
            <>
              {tickets.slice(0, 4).map((t) => (
                <Link
                  key={t.id}
                  href={`/support/${t.id}`}
                  className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3 hover:bg-canvas"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      TICKET_TONE[t.status] === "bad"
                        ? "bg-brand"
                        : TICKET_TONE[t.status] === "good"
                          ? "bg-good-dot"
                          : "bg-faint"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{t.subject}</span>
                    <span className="mt-px block text-xs text-faint">
                      #{t.number} · {TICKET_LABEL[t.status] ?? t.status}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-faint">{t.updatedAt.slice(0, 10)}</span>
                </Link>
              ))}
              <Link
                href="/support"
                className="block px-4 py-3 text-[13px] font-semibold text-brand hover:text-brand-dark"
              >
                View all tickets
              </Link>
            </>
          )}
        </Card>

        {/* Computers */}
        <Card>
          <CardHeader title="Computers" count={summary.total} href="/devices" />
          {deviceList.length === 0 ? (
            <p className="px-4 py-3.5 text-sm text-muted">No computers yet.</p>
          ) : (
            <>
              {deviceList.map((d) => (
                <Link
                  key={d.id}
                  href={devicesSample ? "/devices" : `/devices/${d.id}`}
                  className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3 hover:bg-canvas"
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      d.needsAttention ? "bg-warn-tint text-warn" : "bg-good-tint text-good"
                    }`}
                  >
                    {d.needsAttention ? "!" : "✓"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{d.hostname}</span>
                    <span className="mt-px block truncate text-xs text-faint">{d.user ?? d.os ?? ""}</span>
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-xs font-semibold ${
                      d.needsAttention ? "text-warn" : "text-good"
                    }`}
                  >
                    {d.needsAttention ? "Needs attention" : "Healthy"}
                  </span>
                </Link>
              ))}
              {summary.total > deviceList.length && (
                <p className="px-4 py-3 text-[12.5px] text-faint">
                  + {summary.total - deviceList.length} more —{" "}
                  {summary.needsAttention === 0 ? "all healthy" : "see all"}
                </p>
              )}
            </>
          )}
        </Card>

        {/* Microsoft 365 */}
        <Card>
          <CardHeader title="Microsoft 365" href="/m365" />
          {!m365On ? (
            <p className="px-4 py-3.5 text-sm text-muted">Not connected yet.</p>
          ) : (
            [
              { label: "Licensed people", value: String(m365!.activeLicensed) },
              {
                label: "Two-step sign-in",
                value: m365!.mfaCoverage === null ? "—" : `${m365!.mfaCoverage}%`,
              },
              { label: "Need two-step set up", value: String(pwOnly) },
              ...(licTotal > 0
                ? [{ label: "Spare licences", value: String(licSpare) }]
                : []),
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center border-b border-line-soft px-4 py-[13px] last:border-0"
              >
                <span className="text-[13.5px] text-ink-2">{row.label}</span>
                <span className="ml-auto text-[13.5px] font-semibold text-ink">{row.value}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* Next steps */}
      <Card>
        <CardHeader title="Next steps" />
        {nextSteps.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-good">
            You&apos;re all caught up — nothing needs your attention right now.
          </p>
        ) : (
          nextSteps.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 last:border-0 hover:bg-canvas"
            >
              <span className="text-[13.5px] font-medium text-ink">{s.label}</span>
              <span className="ml-auto text-sm text-muted">→</span>
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}

async function loadTickets(): Promise<{ tickets: TicketSummary[]; ticketsOk: boolean }> {
  const scope = await getSupportScope();
  if (!scope) return { tickets: [], ticketsOk: false };
  try {
    const own = await listConversationsByEmail(scope.email);
    let combined = own;
    if (scope.isManager && scope.clientDomains.length > 0) {
      combined = [...own, ...(await listRecentConversations())];
    }
    const tickets = filterConversations(combined, scope.email, scope.clientDomains).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    return { tickets, ticketsOk: true };
  } catch {
    return { tickets: [], ticketsOk: false };
  }
}
