"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { addTicketNote, reopenTicket, replyAsStaff, setConversationStatus } from "@/lib/freescout";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

/** Staff reply to the customer, attributed to whoever is signed in. */
export async function replyToTicketAction(ticketId: number, formData: FormData) {
  const me = await staff();
  const message = str(formData, "message");
  if (!message) throw new Error("write a message first");
  await replyAsStaff(ticketId, message, me.email);
  revalidatePath(`/admin/tickets/${ticketId}`);
}

/** Internal note — never shown to the client. */
export async function addNoteAction(ticketId: number, formData: FormData) {
  const me = await staff();
  const note = str(formData, "note");
  if (!note) throw new Error("write a note first");
  await addTicketNote(ticketId, note, me.email);
  revalidatePath(`/admin/tickets/${ticketId}`);
}

export async function setTicketStatusAction(ticketId: number, status: "active" | "closed") {
  await staff();
  if (status === "active") await reopenTicket(ticketId);
  else await setConversationStatus(ticketId, "closed");
  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
}

/**
 * Log time against a ticket. The client is resolved from the ticket's email
 * domain where possible; the form carries it so an unmatched domain (personal
 * address, prospect) can still be attributed by hand rather than silently
 * dropped — an unattributed entry would make the client's meter lie.
 */
export async function logTicketTimeAction(ticketId: number, formData: FormData) {
  const me = await staff();
  const clientId = str(formData, "client_id");
  const minutes = Number(formData.get("minutes"));
  if (!clientId) throw new Error("pick the client this time belongs to");
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutes must be positive");
  const workType = String(formData.get("work_type") ?? "ticket");
  const service = createServiceClient();
  const { error } = await service.from("support_time_entries").insert({
    client_id: clientId,
    minutes: Math.round(minutes),
    work_type: ["ticket", "remote", "onsite", "other"].includes(workType) ? workType : "other",
    note: str(formData, "note"),
    freescout_number: ticketId,
    entered_by: me.id,
    occurred_on: str(formData, "occurred_on") ?? undefined,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
}

export async function deleteTicketTimeAction(entryId: string, ticketId: number) {
  await staff();
  const service = createServiceClient();
  await service.from("support_time_entries").delete().eq("id", entryId);
  revalidatePath(`/admin/tickets/${ticketId}`);
}
