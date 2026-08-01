"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTicket, replyToTicket, getConversation, getSupportScope } from "@/lib/freescout";
import { canAccessConversation } from "@/lib/freescout-scope";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportStatus } from "@/lib/views/support-packages";
import { trackAction } from "@/lib/track";
import { createBooking } from "@/lib/actions/bookings";

export type SupportActionState = { error?: string };

/**
 * "Get help": the ticket is always created first — an abandoned payment must
 * never lose the client's description of the problem. When they asked for a
 * session (mode=session), a booking is then anchored to that ticket and they
 * go to Paystack; the session is recorded on this ticket rather than opening
 * a second thread about the same issue.
 */
export async function createTicketAction(
  _prev: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const mode = String(formData.get("mode") ?? "reply");
  if (!subject || !message) return { error: "Subject and message are both required." };

  const scope = await getSupportScope();
  if (!scope) redirect("/login");

  // Stamp the client's tier on the ticket so priority is visible in FreeScout.
  let tags: string[] | undefined;
  const me = await getCurrentProfile();
  if (me.authenticated && me.profile.client_id) {
    const status = await getSupportStatus(me.profile.client_id);
    if (status.pkg) tags = [`tier:${status.pkg.key}`];
  }

  let id: number;
  try {
    id = await createTicket({ email: scope.email, subject, message, tags });
  } catch {
    return { error: "Couldn't create the ticket right now. Please try again shortly." };
  }
  if (me.authenticated) {
    await trackAction(
      { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id },
      "ticket_created",
      subject,
    );
  }

  if (mode === "session") {
    const bookingForm = new FormData();
    bookingForm.set("service_id", String(formData.get("service_id") ?? ""));
    bookingForm.set("slot_iso", String(formData.get("slot_iso") ?? ""));
    bookingForm.set("note", subject);
    bookingForm.set("ticket_number", String(id));
    const booked = await createBooking(null, bookingForm);
    // The ticket exists either way — say so, so a payment hiccup doesn't read
    // as "nothing happened".
    if (!booked.ok) return { error: `${booked.error} Your ticket (#${id}) was logged — we'll pick it up.` };
    redirect(booked.url);
  }

  redirect(`/support/${id}`);
}

export async function replyAction(
  _prev: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const id = Number(formData.get("ticket_id"));
  const message = String(formData.get("message") ?? "").trim();
  if (!id || !message) return { error: "Write a message first." };

  const scope = await getSupportScope();
  if (!scope) redirect("/login");

  try {
    // Re-check scope server-side before proxying the reply.
    const ticket = await getConversation(id);
    if (!ticket || !canAccessConversation(ticket.customerEmail, scope.email, scope.clientDomains)) {
      return { error: "Ticket not found." };
    }
    await replyToTicket(id, scope.email, message);
  } catch {
    return { error: "Couldn't send your reply right now. Please try again shortly." };
  }
  revalidatePath(`/support/${id}`);
  return {};
}
