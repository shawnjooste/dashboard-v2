"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const STATES = new Set(["new", "acknowledged", "escalated", "dismissed"]);

/** Staff-only: set Rocking's triage state on a security event. Source truth
 *  (resolved) is never touched here — that belongs to the normalizer. */
export async function setTriage(eventId: string, formData: FormData) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  const state = String(formData.get("triage_state") ?? "");
  if (!eventId || !STATES.has(state)) throw new Error("invalid triage state");
  const note = String(formData.get("triage_note") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("security_events")
    .update({
      triage_state: state,
      triage_note: note,
      triaged_by: me.profile.id,
      triaged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/security");
}
