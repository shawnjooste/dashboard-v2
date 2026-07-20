import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { openSlots, type SlotBlocker } from "@/lib/booking-helpers";

export type BookingService = { id: string; key: string; name: string; priceCents: number };

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
};

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 27 Jul, 08:00" in SAST (fixed UTC+2) for a stored UTC slot. */
export function slotLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export async function getActiveServices(): Promise<BookingService[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_services")
    .select("id, key, name, price_cents")
    .eq("active", true)
    .order("key");
  return (data ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name, priceCents: s.price_cents }));
}

/** Open slots for the next 10 business days. Availability must see EVERY
 *  client's bookings (capacity is global), which client RLS forbids — so
 *  this uses the service client but exposes only slot times. */
export async function getOpenSlots(): Promise<{ iso: string; label: string }[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .gte("slot_start", new Date().toISOString());
  return openSlots({ now: new Date(), businessDays: 10, blockers: (data ?? []) as SlotBlocker[] });
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
  support_services: { name: string } | null;
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
});

const SELECT =
  "id, slot_start, amount_cents, vat_cents, status, paystack_reference, note, freescout_number, support_services(name)";

export async function getBooking(id: string): Promise<Booking | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("support_bookings").select(SELECT).eq("id", id).maybeSingle();
  return data ? toBooking(data as unknown as BookingRow) : null;
}

export async function getClientBookings(): Promise<Booking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_bookings")
    .select(SELECT)
    .order("slot_start", { ascending: false })
    .limit(20);
  return (data ?? []).map((b) => toBooking(b as unknown as BookingRow));
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
