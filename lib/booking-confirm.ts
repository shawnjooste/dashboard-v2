import { createServiceClient } from "@/lib/supabase/service";
import { addTicketNote, createTicket, reopenTicket } from "@/lib/freescout";
import { bookingNoteText } from "@/lib/booking-note";
import { sendBookingConfirmation } from "@/lib/notify";
import { slotLabel } from "@/lib/calendly-helpers";
import { createCalendlyBooking } from "@/lib/calendly-availability";

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
      "id, client_id, slot_start, amount_cents, vat_cents, status, note, booked_by, ticket_number, support_services(key, name, calendly_event_type_uri), clients(name)",
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
  const svc = b.support_services as unknown as {
    key: string;
    name: string;
    calendly_event_type_uri?: string | null;
  } | null;
  const clientName = (b.clients as unknown as { name: string } | null)?.name ?? "client";
  const label = slotLabel(b.slot_start);
  try {
    const { data: booker } = b.booked_by
      ? await service
          .from("profiles")
          .select("email, people:person_id(display_name)")
          .eq("id", b.booked_by)
          .maybeSingle()
      : { data: null };
    const email = booker?.email;
    const bookerName =
      (booker?.people as unknown as { display_name: string | null } | null)?.display_name ?? null;
    if (email) {
      const { data: pkgRow } = await service
        .from("clients")
        .select("support_package_id, support_packages(key)")
        .eq("id", b.client_id)
        .maybeSingle();
      const tierKey = (pkgRow?.support_packages as unknown as { key: string } | null)?.key ?? "free";
      if (b.ticket_number) {
        // Anchored: the session belongs to a ticket the client already has —
        // note it there and bring the ticket back to life, rather than
        // opening a second thread about the same problem.
        await reopenTicket(b.ticket_number);
        await addTicketNote(
          b.ticket_number,
          bookingNoteText({
            serviceName: svc?.name ?? "Support session",
            slotLabel: label,
            totalCents: due,
            reference,
            note: b.note,
          }),
        );
        await service
          .from("support_bookings")
          .update({ freescout_number: b.ticket_number })
          .eq("id", b.id);
      } else {
        // Legacy path: bookings made before sessions were ticket-anchored.
        const ticketId = await createTicket({
          email,
          subject: `Paid ${svc?.name ?? "support session"}: ${label} — ${clientName}`,
          message: `Paid booking confirmed (ref ${reference}).\n\nService: ${svc?.name}\nSlot: ${label}\nClient: ${clientName}\n\nClient's note:\n${b.note ?? "—"}`,
          tags: ["booking", `tier:${tierKey}`],
        });
        await service.from("support_bookings").update({ freescout_number: ticketId }).eq("id", b.id);
      }
      await sendBookingConfirmation({
        to: email,
        serviceName: svc?.name ?? "Support session",
        slotLabel: label,
        totalCents: due,
        reference,
        clientId: b.client_id,
      });
      // Put the session on Tim's calendar via Calendly (invites him + the
      // client natively). Best-effort like everything in this block.
      if (svc?.calendly_event_type_uri) {
        const created = await createCalendlyBooking({
          eventTypeUri: svc.calendly_event_type_uri,
          startIso: b.slot_start,
          invitee: { name: bookerName ?? email.split("@")[0], email },
          note: b.note,
        });
        if (created?.eventUri) {
          await service
            .from("support_bookings")
            .update({ calendly_event_uri: created.eventUri })
            .eq("id", b.id);
        }
      }
    }
  } catch (e) {
    console.error("booking side-effects failed (payment is recorded):", e);
  }
  return "confirmed";
}
