"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTicket, replyToTicket, getConversation, getSupportScope } from "@/lib/freescout";
import { canAccessConversation } from "@/lib/freescout-scope";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportStatus } from "@/lib/views/support-packages";

export type SupportActionState = { error?: string };

export async function createTicketAction(
  _prev: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
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
