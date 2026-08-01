"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { slotTaken, totalCents, vatCents, type SlotBlocker } from "@/lib/booking-helpers";
import { slotLabel } from "@/lib/calendly-helpers";
import { bookingCancelledNoteText } from "@/lib/booking-note";
import { initializeTransaction } from "@/lib/paystack";
import { cancelCalendlyEvent } from "@/lib/calendly-availability";
import { addTicketNote, getConversation, getSupportScope } from "@/lib/freescout";
import { canAccessConversation } from "@/lib/freescout-scope";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export type CreateBookingResult = { ok: true; url: string } | { ok: false; error: string };

/** Any portal user of a client books for their company. Slot re-check and
 *  hold-insert first; Paystack initialize second; a failed initialize
 *  releases the hold. Payment confirmation happens in the webhook/verify. */
export async function createBooking(
  _prev: CreateBookingResult | null,
  formData: FormData,
): Promise<CreateBookingResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.client_id) return { ok: false, error: "Sign in to book." };
  const serviceId = String(formData.get("service_id") ?? "");
  const slotIso = String(formData.get("slot_iso") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!serviceId || !slotIso || isNaN(Date.parse(slotIso))) return { ok: false, error: "Pick a service and a slot." };

  const service = createServiceClient();
  const { data: svc } = await service
    .from("support_services")
    .select("id, name, price_cents, duration_minutes, active")
    .eq("id", serviceId)
    .maybeSingle();
  if (!svc?.active) return { ok: false, error: "That service isn't available." };

  // Re-check against ALL clients' bookings (capacity is global). Durations
  // differ per service, so fetch anything that could overlap and compare
  // intervals rather than looking for an identical start time.
  const windowStart = new Date(Date.parse(slotIso) - 4 * 3_600_000).toISOString();
  const windowEnd = new Date(Date.parse(slotIso) + 4 * 3_600_000).toISOString();
  const { data: blockers } = await service
    .from("support_bookings")
    .select("slot_start, slot_end, status, created_at")
    .gte("slot_start", windowStart)
    .lte("slot_start", windowEnd);
  if (slotTaken(slotIso, svc.duration_minutes, (blockers ?? []) as SlotBlocker[], new Date())) {
    return { ok: false, error: "That slot was just taken — pick another." };
  }

  // The ticket this session belongs to. A client must not be able to anchor a
  // booking onto someone else's conversation, so check it against their own
  // support scope — the same guard the ticket pages use.
  const ticketRaw = String(formData.get("ticket_number") ?? "").trim();
  let ticketNumber: number | null = null;
  if (ticketRaw) {
    const n = Number(ticketRaw);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "That ticket doesn't look right." };
    const scope = await getSupportScope();
    const ticket = scope ? await getConversation(n) : null;
    if (!scope || !ticket || !canAccessConversation(ticket.customerEmail, scope.email, scope.clientDomains)) {
      return { ok: false, error: "That ticket isn't yours to book against." };
    }
    ticketNumber = n;
  }

  const reference = `bk_${crypto.randomUUID()}`;
  const slotEnd = new Date(Date.parse(slotIso) + svc.duration_minutes * 60_000).toISOString();
  const supabase = await createClient(); // RLS: insert allowed for own client, pending only
  const { data: booking, error: insErr } = await supabase
    .from("support_bookings")
    .insert({
      client_id: me.profile.client_id,
      service_id: svc.id,
      slot_start: slotIso,
      slot_end: slotEnd,
      amount_cents: svc.price_cents,
      vat_cents: vatCents(svc.price_cents),
      paystack_reference: reference,
      booked_by: me.profile.id,
      note,
      ticket_number: ticketNumber,
    })
    .select("id")
    .single();
  if (insErr || !booking) return { ok: false, error: "Couldn't hold that slot — try again." };

  try {
    const url = await initializeTransaction({
      email: me.profile.email,
      amountCents: totalCents(svc.price_cents),
      reference,
      callbackUrl: `${APP_URL}/support/bookings/${booking.id}`,
    });
    revalidatePath("/support");
    return { ok: true, url };
  } catch (e) {
    await service.from("support_bookings").delete().eq("id", booking.id); // release the hold
    console.error("paystack initialize failed:", e);
    return { ok: false, error: "Payment couldn't be started — nothing was booked. Try again shortly." };
  }
}

export async function markBookingCompleted(id: string) {
  await staff();
  const service = createServiceClient();
  await service.from("support_bookings").update({ status: "completed" }).eq("id", id).eq("status", "paid");
  revalidatePath("/admin/support-packages");
}

export async function cancelBooking(id: string) {
  await staff();
  const service = createServiceClient();
  await service
    .from("support_bookings")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending_payment", "paid"]);
  // Free Tim's calendar and tell the ticket — both best-effort, the portal
  // cancellation stands regardless.
  const { data: b } = await service
    .from("support_bookings")
    .select("calendly_event_uri, ticket_number, slot_start, support_services(name)")
    .eq("id", id)
    .maybeSingle();
  if (b?.calendly_event_uri) {
    await cancelCalendlyEvent(b.calendly_event_uri, "Cancelled via the Rocking portal");
  }
  if (b?.ticket_number) {
    try {
      await addTicketNote(
        b.ticket_number,
        bookingCancelledNoteText({
          serviceName: (b.support_services as unknown as { name: string } | null)?.name ?? "session",
          slotLabel: slotLabel(b.slot_start),
        }),
      );
    } catch (e) {
      console.error("cancel note failed:", e);
    }
  }
  revalidatePath("/admin/support-packages");
  revalidatePath("/admin/bookings");
  revalidatePath("/support");
}

export async function saveServicePrice(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const rands = Number(formData.get("price_rands"));
  if (!id || !Number.isFinite(rands) || rands <= 0) throw new Error("invalid price");
  const uri = str(formData, "calendly_uri");
  if (uri && !uri.startsWith("https://api.calendly.com/event_types/")) {
    throw new Error("Calendly event type URI must look like https://api.calendly.com/event_types/…");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("support_services")
    .update({ price_cents: Math.round(rands * 100), calendly_event_type_uri: uri })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/support-packages");
  revalidatePath("/support");
}
