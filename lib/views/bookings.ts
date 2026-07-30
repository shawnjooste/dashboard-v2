import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { PENDING_HOLD_MINUTES, openSlots, slotTaken, type SlotBlocker } from "@/lib/booking-helpers";
import { slotLabel } from "@/lib/calendly-helpers";
import { getCalendlySlots } from "@/lib/calendly-availability";

export { slotLabel };

export type BookingService = {
  id: string;
  key: string;
  name: string;
  priceCents: number;
  calendlyEventTypeUri: string | null;
};

export type Booking = {
  id: string;
  serviceName: string;
  slotStart: string;
  slotLabel: string;
  amountCents: number;
  vatCents: number;
  status: string;
  reference: string;
  note: string | null;
  freescoutNumber: number | null;
  clientName?: string;
  calendlyEventUri: string | null;
  /** Whether this booking's service is mapped to a Calendly event type. */
  serviceMapped: boolean;
};

export async function getActiveServices(): Promise<BookingService[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_services")
    .select("id, key, name, price_cents, calendly_event_type_uri")
    .eq("active", true)
    .order("key");
  return (data ?? []).map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    priceCents: s.price_cents,
    calendlyEventTypeUri: s.calendly_event_type_uri,
  }));
}

/** Per-service open slots. Calendly (Tim's real calendar) when the service is
 *  mapped and reachable; internal business-hours grid otherwise. In BOTH
 *  paths our own live bookings are subtracted — the internal double-book
 *  backstop against Calendly sync lag. Blocker data must see EVERY client's
 *  bookings (capacity is global), which client RLS forbids — so the service
 *  client reads them, exposing only slot times. */
export async function getOpenSlotsByService(
  services: BookingService[],
): Promise<Record<string, { iso: string; label: string }[]>> {
  const service = createServiceClient();
  const { data } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .gte("slot_start", new Date().toISOString());
  const blockers = (data ?? []) as SlotBlocker[];
  const now = new Date();
  const internal = openSlots({ now, businessDays: 10, blockers });

  const out: Record<string, { iso: string; label: string }[]> = {};
  for (const svc of services) {
    let slots: { iso: string; label: string }[] | null = null;
    if (svc.calendlyEventTypeUri) {
      slots = await getCalendlySlots(svc.calendlyEventTypeUri);
      if (slots) slots = slots.filter((s) => !slotTaken(s.iso, blockers, now));
    }
    out[svc.id] = slots ?? internal;
  }
  return out;
}

type BookingRow = {
  id: string;
  slot_start: string;
  amount_cents: number;
  vat_cents: number;
  status: string;
  paystack_reference: string;
  note: string | null;
  freescout_number: number | null;
  calendly_event_uri: string | null;
  support_services: { name: string; calendly_event_type_uri: string | null } | null;
  clients?: { name: string } | null;
};

const toBooking = (b: BookingRow): Booking => ({
  id: b.id,
  serviceName: b.support_services?.name ?? "Support session",
  slotStart: b.slot_start,
  slotLabel: slotLabel(b.slot_start),
  amountCents: b.amount_cents,
  vatCents: b.vat_cents,
  status: b.status,
  reference: b.paystack_reference,
  note: b.note,
  freescoutNumber: b.freescout_number,
  clientName: b.clients?.name,
  calendlyEventUri: b.calendly_event_uri,
  serviceMapped: !!b.support_services?.calendly_event_type_uri,
});

const SELECT =
  "id, slot_start, amount_cents, vat_cents, status, paystack_reference, note, freescout_number, calendly_event_uri, support_services(name, calendly_event_type_uri)";

export async function getBooking(id: string): Promise<Booking | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("support_bookings").select(SELECT).eq("id", id).maybeSingle();
  return data ? toBooking(data as unknown as BookingRow) : null;
}

export async function getClientBookings(): Promise<Booking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_bookings")
    .select(`${SELECT}, created_at`)
    .order("slot_start", { ascending: false })
    .limit(20);
  // Hide lapsed unpaid holds: an abandoned checkout frees its slot after the
  // hold window, so its dead "Awaiting payment" row shouldn't linger either.
  const cutoff = Date.now() - PENDING_HOLD_MINUTES * 60_000;
  return (data ?? [])
    .filter(
      (b) =>
        (b as { status: string }).status !== "pending_payment" ||
        new Date((b as unknown as { created_at: string }).created_at).getTime() > cutoff,
    )
    .map((b) => toBooking(b as unknown as BookingRow));
}

/** Staff: all bookings, newest slots first, with the client name. */
export async function getAllBookings(limit = 30): Promise<Booking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_bookings")
    .select(`${SELECT}, clients(name)`)
    .order("slot_start", { ascending: false })
    .limit(limit);
  return (data ?? []).map((b) => toBooking(b as unknown as BookingRow));
}
