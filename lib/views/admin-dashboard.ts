import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth } from "./devices";
import { getAllPeople } from "./people";
import { getVisibleQuotes } from "./quotes";
import { getM365Overview } from "./m365";
import { listRecentConversations } from "@/lib/freescout";
import { fmtMoney } from "@/lib/quotes/doc";
import { type DeviceHealth } from "./health";

/** One actionable line in a panel. `href` makes the primary text a link. */
export type DashItem = {
  id: string;
  primary: string;
  secondary?: string;
  href?: string;
};

export type DashPanel = { count: number; items: DashItem[] };

export type AdminDashboard = {
  kpis: {
    clients: number;
    devices: number;
    pipeline: number; // R value of quotes awaiting a client decision
    mfaCoverage: number | null; // % across connected tenants
  };
  approvals: DashPanel;
  attention: DashPanel;
  mfaGaps: DashPanel;
  quotes: DashPanel;
  tickets: DashPanel & { ok: boolean };
};

const TOP = 3;

function deviceReason(d: DeviceHealth): string {
  if (d.flags.openAlerts) return `${d.openAlerts} open alert${d.openAlerts === 1 ? "" : "s"}`;
  if (d.flags.avOff) return "AV disabled";
  if (d.flags.patchIssue) return "patch overdue";
  if (d.flags.diskFull) return "disk almost full";
  return "needs attention";
}

function ageLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Open (non-closed) helpdesk tickets across all clients. Best-effort: a
 *  FreeScout outage degrades to ok:false rather than failing the dashboard. */
async function getOpenTickets(): Promise<AdminDashboard["tickets"]> {
  try {
    const convs = await listRecentConversations();
    const open = convs.filter((c) => c.status !== "closed");
    return {
      ok: true,
      count: open.length,
      items: open.slice(0, TOP).map((c) => ({
        id: String(c.id),
        primary: c.subject,
        secondary: `${c.customerEmail ?? "unknown"} · ${ageLabel(c.updatedAt)}`,
      })),
    };
  } catch {
    return { ok: false, count: 0, items: [] };
  }
}

/** Everything the admin overview needs, gathered across all clients in one pass. */
export async function getAdminDashboard(): Promise<AdminDashboard> {
  const supabase = await createClient();
  const [clientsRes, pendingRes, devices, people, quotes, m365, tickets] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("profiles").select("id, email, client_id, created_at").eq("status", "pending"),
    getVisibleDeviceHealth(),
    getAllPeople(),
    getVisibleQuotes(),
    getM365Overview(),
    getOpenTickets(),
  ]);

  const clientName = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]));

  // Approvals — members waiting for staff to admit them.
  const pending = pendingRes.data ?? [];
  const approvals: DashPanel = {
    count: pending.length,
    items: pending.slice(0, TOP).map((p) => ({
      id: p.id,
      primary: p.email,
      secondary: p.client_id ? clientName.get(p.client_id) ?? "—" : "Unassigned",
    })),
  };

  // Devices needing attention across the fleet.
  const att = devices.filter((d) => d.needsAttention);
  const attention: DashPanel = {
    count: att.length,
    items: att.slice(0, TOP).map((d) => ({
      id: d.id,
      primary: d.hostname,
      secondary: `${clientName.get(d.clientId) ?? "—"} · ${deviceReason(d)}`,
      href: `/admin/devices/${d.id}`,
    })),
  };

  // People with M365 but weak/absent MFA.
  const gaps = people.filter((p) => p.hasM365 && p.mfaStrong === false);
  const mfaGaps: DashPanel = {
    count: gaps.length,
    items: gaps.slice(0, TOP).map((p) => ({
      id: p.id,
      primary: p.name,
      secondary: p.clientName,
      href: `/admin/people/${p.id}`,
    })),
  };

  // Quotes the client hasn't acted on yet (derived 'sent' excludes expired/decided).
  const awaiting = quotes.filter((q) => q.status === "sent");
  const pipeline = awaiting.reduce((n, q) => n + (q.grandTotal ?? 0), 0);
  const quotesPanel: DashPanel = {
    count: awaiting.length,
    items: awaiting.slice(0, TOP).map((q) => ({
      id: q.id,
      primary: `${q.quoteNumber} · ${q.title}`,
      secondary: `${q.grandTotal != null ? fmtMoney(q.grandTotal) : "—"} · ${ageLabel(q.createdAt)}`,
      href: `/admin/quotes/${q.id}`,
    })),
  };

  return {
    kpis: {
      clients: (clientsRes.data ?? []).length,
      devices: devices.length,
      pipeline,
      mfaCoverage: m365.totals.mfaCoverage,
    },
    approvals,
    attention,
    mfaGaps,
    quotes: quotesPanel,
    tickets,
  };
}
