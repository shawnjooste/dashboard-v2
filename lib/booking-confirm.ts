import { createServiceClient } from "@/lib/supabase/service";
import { createTicket } from "@/lib/freescout";
import { sendBookingConfirmation } from "@/lib/notify";
import { slotLabel } from "@/lib/views/bookings";

/** Flip a booking to paid once payment is verified. Idempotent — the webhook
 *  and the booking page's verify fallback can both call this safely. The
 *  paid-flip is the critical write; FreeScout/email failures must not undo it. */
export async function confirmBooking(
  reference: string,
  amountPaidCents: number,
): Promise<"confirmed" | "already" | "not_found" | "underpaid"> {
  const service = createServiceClient();
  const { data: b } = await service
    .from("support_bookings")
    .select(
      "id, client_id, slot_start, amount_cents, vat_cents, status, note, booked_by, support_services(key, name), clients(name)",
    )
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (!b) return "not_found";
  if (b.status !== "pending_payment") return "already";
  const due = b.amount_cents + b.vat_cents;
  if (amountPaidCents < due) {
    console.error(`booking ${b.id}: paid ${amountPaidCents} < due ${due}`);
    return "underpaid";
  }

  const { error } = await service
    .from("support_bookings")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "pending_payment");
  if (error) throw new Error(error.message);

  // Side-effects are best-effort — never let them look like payment failure.
  const svc = b.support_services as unknown as { key: string; name: string } | null;
  const clientName = (b.clients as unknown as { name: string } | null)?.name ?? "client";
  const label = slotLabel(b.slot_start);
  try {
    const { data: booker } = b.booked_by
      ? await service.from("profiles").select("email").eq("id", b.booked_by).maybeSingle()
      : { data: null };
    const email = booker?.email;
    if (email) {
      const { data: pkgRow } = await service
        .from("clients")
        .select("support_package_id, support_packages(key)")
        .eq("id", b.client_id)
        .maybeSingle();
      const tierKey = (pkgRow?.support_packages as unknown as { key: string } | null)?.key ?? "free";
      const ticketId = await createTicket({
        email,
        subject: `Paid ${svc?.name ?? "support session"}: ${label} — ${clientName}`,
        message: `Paid booking confirmed (ref ${reference}).\n\nService: ${svc?.name}\nSlot: ${label}\nClient: ${clientName}\n\nClient's note:\n${b.note ?? "—"}`,
        tags: ["booking", `tier:${tierKey}`],
      });
      await service.from("support_bookings").update({ freescout_number: ticketId }).eq("id", b.id);
      await sendBookingConfirmation({
        to: email,
        serviceName: svc?.name ?? "Support session",
        slotLabel: label,
        totalCents: due,
        reference,
        clientId: b.client_id,
      });
    }
  } catch (e) {
    console.error("booking side-effects failed (payment is recorded):", e);
  }
  return "confirmed";
}
