"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { notifyIncident } from "@/lib/status-email";
import { trackAction } from "@/lib/track";
import { INCIDENT_TYPES } from "@/lib/status-helpers";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

/** Posts an incident AND its first update in one go — an incident is never a
 *  headline with no story. Emails go out after the write succeeds. */
export async function postIncident(formData: FormData) {
  const me = await staff();
  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const scope = String(formData.get("scope") ?? "global");
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) throw new Error("A title and a first update are both required");
  if (!(INCIDENT_TYPES as readonly string[]).includes(type)) throw new Error("invalid type");
  if (scope !== "global" && scope !== "clients") throw new Error("invalid scope");
  const clientIds = formData.getAll("client_ids").map(String).filter(Boolean);
  if (scope === "clients" && clientIds.length === 0) {
    throw new Error("Pick at least one client, or post it as global");
  }
  // Incident mode: live chat for everyone this incident reaches, until it is
  // resolved. Nothing else turns it on and nothing else turns it off.
  const opensChat = formData.get("opens_chat") === "on";

  const supabase = await createClient();
  const { data: incident, error } = await supabase
    .from("status_incidents")
    .insert({ title, type, scope, opens_chat: opensChat, created_by: me.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (scope === "clients") {
    const { error: tErr } = await supabase
      .from("status_incident_clients")
      .insert(clientIds.map((client_id) => ({ incident_id: incident.id, client_id })));
    if (tErr) throw new Error(tErr.message);
  }
  const { error: uErr } = await supabase
    .from("status_updates")
    .insert({ incident_id: incident.id, body, created_by: me.id });
  if (uErr) throw new Error(uErr.message);

  await notifyIncident(incident.id, body);
  revalidatePath("/status");
}

export async function postUpdate(incidentId: string, formData: FormData) {
  const me = await staff();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Write an update first");
  const supabase = await createClient();
  const { error } = await supabase
    .from("status_updates")
    .insert({ incident_id: incidentId, body, created_by: me.id });
  if (error) throw new Error(error.message);
  await notifyIncident(incidentId, body);
  revalidatePath("/status");
}

/** Resolution is an update too — with the flag set and the incident closed. */
export async function resolveIncident(incidentId: string, formData: FormData) {
  const me = await staff();
  const body = String(formData.get("body") ?? "").trim() || "This incident has been resolved.";
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("status_incidents")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("id", incidentId);
  if (error) throw new Error(error.message);
  const { error: uErr } = await supabase
    .from("status_updates")
    .insert({ incident_id: incidentId, body, is_resolution: true, created_by: me.id });
  if (uErr) throw new Error(uErr.message);
  await notifyIncident(incidentId, body, { resolved: true });
  revalidatePath("/status");
}

/** A user's own opt-in. Row present = subscribed. RLS restricts this to the
 *  caller's own row, so no ownership check is needed here. */
export async function setStatusSubscription(subscribe: boolean) {
  const me = await getCurrentProfile();
  if (!me.authenticated) throw new Error("sign in first");
  const supabase = await createClient();
  if (subscribe) {
    const { error } = await supabase
      .from("status_subscriptions")
      .upsert({ profile_id: me.profile.id }, { onConflict: "profile_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("status_subscriptions").delete().eq("profile_id", me.profile.id);
    if (error) throw new Error(error.message);
  }
  // The table only holds current state — log the change so the feed shows who
  // opted in or out, and when.
  await trackAction(
    { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id },
    "status",
    subscribe ? "turned status emails on" : "turned status emails off",
  );
}
