"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

export type NameResult = { error: string } | null;

/** Saves the signed-in user's first/last name onto their own Person record,
 *  then sends them into the portal. People writes are staff-only under RLS, so
 *  this uses the service client — scoped to the caller's own person_id. */
export async function saveMyName(_prev: NameResult, formData: FormData): Promise<NameResult> {
  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  if (!first || !last) return { error: "Please enter both your first and last name." };

  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.person_id || !me.profile.client_id) {
    return { error: "We couldn't find your profile — try signing in again." };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("people")
    .update({ first_name: first, last_name: last, display_name: `${first} ${last}` })
    .eq("id", me.profile.person_id)
    .eq("client_id", me.profile.client_id);
  if (error) return { error: "Something went wrong saving your name. Please try again." };

  redirect("/");
}
