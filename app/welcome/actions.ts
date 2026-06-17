"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

export type NameResult = { error: string } | null;

/** Saves the signed-in user's first/last name onto their own Person, then sends
 *  them into the portal. Uses the set_my_name RPC (SECURITY DEFINER, scoped to
 *  the caller's own person) via the authenticated client — so it never depends
 *  on a service-role key being present in the deployed environment. */
export async function saveMyName(_prev: NameResult, formData: FormData): Promise<NameResult> {
  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  if (!first || !last) return { error: "Please enter both your first and last name." };

  const me = await getCurrentProfile();
  if (!me.authenticated) return { error: "We couldn't find your profile — try signing in again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_name", { p_first: first, p_last: last });
  if (error) return { error: "Something went wrong saving your name. Please try again." };

  redirect("/");
}
