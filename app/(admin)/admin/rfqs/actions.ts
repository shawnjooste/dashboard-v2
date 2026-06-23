"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { RFQ_STATUS_LABEL, type RfqStatus } from "@/lib/views/rfqs";

const STATUSES: RfqStatus[] = ["new", "sourcing", "quoted", "won", "lost"];

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

async function logEvent(
  supabase: SupabaseClient,
  rfqId: string,
  kind: "created" | "status" | "quote_linked" | "note",
  body: string | null,
  actorId: string,
) {
  await supabase.from("rfq_events").insert({ rfq_id: rfqId, kind, body, posted_by_profile_id: actorId });
}

export async function createRfq(formData: FormData) {
  const me = await staff();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title is required");
  const clientId = String(formData.get("client_id") ?? "") || null;
  const clientName = clientId ? null : String(formData.get("client_name") ?? "").trim() || null;
  const requestedBy = String(formData.get("requested_by") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const neededBy = String(formData.get("needed_by") ?? "") || null;
  const sourcingNote = String(formData.get("sourcing_note") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: rfq, error } = await supabase
    .from("rfqs")
    .insert({
      title,
      client_id: clientId,
      client_name: clientName,
      requested_by: requestedBy,
      description,
      needed_by: neededBy,
      sourcing_note: sourcingNote,
      owner_profile_id: me.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logEvent(supabase, rfq.id, "created", null, me.id);
  revalidatePath("/admin/rfqs");
  redirect(`/admin/rfqs/${rfq.id}`);
}

/** Move stage. `note` becomes the sourcing note (when sourcing) or lost reason (when lost). */
export async function setRfqStatus(rfqId: string, status: RfqStatus, note: string | null) {
  const me = await staff();
  if (!STATUSES.includes(status)) throw new Error("invalid status");
  const supabase = await createClient();
  const { data: rfq } = await supabase.from("rfqs").select("status").eq("id", rfqId).maybeSingle();
  if (!rfq) throw new Error("rfq not found");

  const closing = status === "won" || status === "lost";
  const wasClosed = rfq.status === "won" || rfq.status === "lost";
  const patch: {
    status: RfqStatus;
    sourcing_note: string | null;
    lost_reason: string | null;
    updated_at: string;
    closed_at?: string | null;
  } = {
    status,
    sourcing_note: status === "sourcing" ? note?.trim() || null : null,
    lost_reason: status === "lost" ? note?.trim() || null : null,
    updated_at: new Date().toISOString(),
  };
  if (closing && !wasClosed) patch.closed_at = new Date().toISOString();
  if (!closing && wasClosed) patch.closed_at = null;

  await supabase.from("rfqs").update(patch).eq("id", rfqId);
  await logEvent(supabase, rfqId, "status", `→ ${RFQ_STATUS_LABEL[status]}`, me.id);
  revalidatePath("/admin/rfqs");
  revalidatePath(`/admin/rfqs/${rfqId}`);
}

/** Attach an existing client quote → advance to Quoted. */
export async function linkQuote(rfqId: string, quoteId: string) {
  const me = await staff();
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("quote_number").eq("id", quoteId).maybeSingle();
  if (!q) throw new Error("quote not found");
  await supabase
    .from("rfqs")
    .update({ quote_id: quoteId, status: "quoted", updated_at: new Date().toISOString() })
    .eq("id", rfqId);
  await logEvent(supabase, rfqId, "quote_linked", q.quote_number, me.id);
  revalidatePath("/admin/rfqs");
  revalidatePath(`/admin/rfqs/${rfqId}`);
}

export async function saveRfqDetails(formData: FormData) {
  await staff();
  const id = String(formData.get("rfq_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("rfqs")
    .update({
      requested_by: String(formData.get("requested_by") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      needed_by: String(formData.get("needed_by") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(`/admin/rfqs/${id}`);
}
