import { createServiceClient } from "@/lib/supabase/service";
import { getConversation, listRecentConversations, type TicketDetail, type TicketSummary } from "@/lib/freescout";
import { clientIdForEmail, minutesByTicket, type DomainRow } from "@/lib/ticket-client-map";

export type AdminTicketRow = TicketSummary & {
  clientId: string | null;
  clientName: string | null;
  loggedMinutes: number;
};

export type AdminTicketDetail = {
  ticket: TicketDetail;
  clientId: string | null;
  clientName: string | null;
  loggedMinutes: number;
  entries: { id: string; minutes: number; workType: string; note: string | null; author: string | null; occurredOn: string }[];
  bookings: { id: string; serviceName: string; slotLabel: string; status: string }[];
  clients: { id: string; name: string }[];
  /** Neighbours in the ticket list, so you can work straight through the
   *  queue instead of bouncing back to the index between each one. */
  prev: { id: number; subject: string } | null;
  next: { id: number; subject: string } | null;
};

/** Client lookup tables — the service client is right here: staff see every
 *  client, and a scheduled/admin context has no client scoping to inherit. */
async function clientLookup() {
  const service = createServiceClient();
  const [{ data: domains }, { data: clients }] = await Promise.all([
    service.from("client_domains").select("client_id, domain"),
    service.from("clients").select("id, name").order("name"),
  ]);
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return { domains: (domains ?? []) as DomainRow[], nameById, clients: clients ?? [] };
}

/** Every recent ticket across all clients, with who it belongs to and how
 *  much time has been logged against it. */
export async function getAdminTickets(): Promise<AdminTicketRow[]> {
  const service = createServiceClient();
  const [tickets, { domains, nameById }, { data: entries }] = await Promise.all([
    listRecentConversations(),
    clientLookup(),
    service.from("support_time_entries").select("freescout_number, minutes"),
  ]);
  const mins = minutesByTicket(entries ?? []);
  return tickets.map((t) => {
    const clientId = clientIdForEmail(t.customerEmail, domains);
    return {
      ...t,
      clientId,
      clientName: clientId ? (nameById.get(clientId) ?? null) : null,
      loggedMinutes: mins.get(t.id) ?? 0,
    };
  });
}

export async function getAdminTicket(id: number): Promise<AdminTicketDetail | null> {
  const ticket = await getConversation(id);
  if (!ticket) return null;
  const service = createServiceClient();
  const { domains, nameById, clients } = await clientLookup();
  const clientId = clientIdForEmail(ticket.customerEmail, domains);

  const [{ data: entryRows }, { data: bookingRows }, { data: profiles }, neighbours] = await Promise.all([
    service
      .from("support_time_entries")
      .select("id, minutes, work_type, note, entered_by, occurred_on")
      .eq("freescout_number", id)
      .order("occurred_on", { ascending: false }),
    service
      .from("support_bookings")
      .select("id, slot_start, status, support_services(name)")
      .eq("ticket_number", id)
      .order("slot_start", { ascending: false }),
    service.from("profiles").select("id, email"),
    listRecentConversations().catch(() => [] as TicketSummary[]),
  ]);

  // Same order as the list page (most recently updated first), so "next"
  // means what it looks like it means on screen.
  const at = neighbours.findIndex((t) => t.id === id);
  const nb = (i: number) => {
    const t = at >= 0 ? neighbours[i] : undefined;
    return t ? { id: t.id, subject: t.subject } : null;
  };

  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (pid: string | null) => {
    const e = pid ? email.get(pid) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  const { slotLabel } = await import("@/lib/calendly-helpers");

  return {
    ticket,
    clientId,
    clientName: clientId ? (nameById.get(clientId) ?? null) : null,
    loggedMinutes: (entryRows ?? []).reduce((n, e) => n + e.minutes, 0),
    entries: (entryRows ?? []).map((e) => ({
      id: e.id,
      minutes: e.minutes,
      workType: e.work_type,
      note: e.note,
      author: label(e.entered_by),
      occurredOn: e.occurred_on,
    })),
    bookings: (bookingRows ?? []).map((b) => ({
      id: b.id,
      serviceName: (b.support_services as unknown as { name: string } | null)?.name ?? "Session",
      slotLabel: slotLabel(b.slot_start),
      status: b.status,
    })),
    clients,
    prev: nb(at - 1),
    next: nb(at + 1),
  };
}
