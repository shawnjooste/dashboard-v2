import { getAdminDashboard } from "@/lib/views/admin-dashboard";
import { DashboardPanel } from "@/components/DashboardPanel";
import { fmtMoney } from "@/lib/quotes/doc";

export default async function AdminHome() {
  const d = await getAdminDashboard();

  const kpis: { label: string; value: string; dot: string }[] = [
    { label: "CLIENTS", value: String(d.kpis.clients), dot: "#18181B" },
    { label: "DEVICES MANAGED", value: String(d.kpis.devices), dot: "#18181B" },
    { label: "AWAITING CLIENT", value: fmtMoney(d.kpis.pipeline), dot: "#185FA5" },
    {
      label: "MFA COVERAGE",
      value: d.kpis.mfaCoverage == null ? "—" : `${d.kpis.mfaCoverage}%`,
      dot: d.kpis.mfaCoverage != null && d.kpis.mfaCoverage < 100 ? "#B45309" : "#15803D",
    },
  ];

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-3">
        <h1 className="text-[30px] font-bold tracking-[-0.6px] text-ink">Overview</h1>
        <span className="rounded-full border border-line bg-line-soft px-[11px] py-[3px] text-[13px] font-semibold text-ink-3">
          {d.kpis.clients} clients
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted">Everything that needs you, across all clients.</p>

      {/* Business glance */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[10px] border border-line bg-card px-4 py-3.5">
            <span className="flex items-center gap-[7px]">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: k.dot }} />
              <span className="text-xs font-semibold tracking-[0.3px] text-muted">{k.label}</span>
            </span>
            <span className="mt-2 block text-[26px] font-bold leading-none text-ink">{k.value}</span>
          </div>
        ))}
      </div>

      {/* Action panels */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="Approvals waiting"
          count={d.approvals.count}
          hot
          items={d.approvals.items}
          viewAll={{ label: "Review approvals", href: "/admin/pending" }}
          empty="No one waiting — you're clear."
        />
        <DashboardPanel
          title="Devices needing attention"
          count={d.attention.count}
          hot
          items={d.attention.items}
          viewAll={{ label: "View by client", href: "/admin/clients" }}
          empty="The whole fleet is healthy."
        />
        <DashboardPanel
          title="Security gaps · MFA off"
          count={d.mfaGaps.count}
          hot
          items={d.mfaGaps.items}
          viewAll={{ label: "Open Microsoft 365", href: "/admin/m365" }}
          empty="Every licensed user has strong MFA."
        />
        <DashboardPanel
          title="Quotes awaiting client"
          count={d.quotes.count}
          items={d.quotes.items}
          empty="No quotes waiting on a client."
        />
        <DashboardPanel
          title="Open tickets"
          count={d.tickets.count}
          items={d.tickets.items}
          viewAll={{ label: "Open helpdesk", href: "https://help.rocking.co.za", external: true }}
          empty={d.tickets.ok ? "No open tickets right now." : "Ticket counts are unavailable right now."}
        />
      </div>
    </div>
  );
}
