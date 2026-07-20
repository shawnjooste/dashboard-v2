"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { slotTaken, totalCents, vatCents, type SlotBlocker } from "@/lib/booking-helpers";
import { initializeTransaction } from "@/lib/paystack";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

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
    .select("id, name, price_cents, active")
    .eq("id", serviceId)
    .maybeSingle();
  if (!svc?.active) return { ok: false, error: "That service isn't available." };

  // Re-check the slot against ALL clients' bookings (global capacity).
  const { data: blockers } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .eq("slot_start", slotIso);
  if (slotTaken(slotIso, (blockers ?? []) as SlotBlocker[], new Date())) {
    return { ok: false, error: "That slot was just taken — pick another." };
  }

  const reference = `bk_${crypto.randomUUID()}`;
  const slotEnd = new Date(Date.parse(slotIso) + 3_600_000).toISOString();
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
  revalidatePath("/admin/support-packages");
  revalidatePath("/support");
}

export async function saveServicePrice(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const rands = Number(formData.get("price_rands"));
  if (!id || !Number.isFinite(rands) || rands <= 0) throw new Error("invalid price");
  const supabase = await createClient();
  const { error } = await supabase
    .from("support_services")
    .update({ price_cents: Math.round(rands * 100) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/support-packages");
  revalidatePath("/support");
}
