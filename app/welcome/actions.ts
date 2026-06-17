"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

export type NameResult = { error: string } | null;

/** Saves the signed-in user's first/last name onto their own Person via the
 *  set_my_name RPC, then sends them into the portal. Any failure is returned as
 *  an inline error so the action never crashes the page. */
export async function saveMyName(_prev: NameResult, formData: FormData): Promise<NameResult> {
  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  if (!first || !last) return { error: "Please enter both your first and last name." };

  try {
    const me = await getCurrentProfile();
    if (!me.authenticated) return { error: "We couldn't find your profile — try signing in again." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_my_name", { p_first: first, p_last: last });
    if (error) return { error: `Couldn't save your name: ${error.message}` };
  } catch (e) {
    return { error: `Couldn't save your name: ${e instanceof Error ? e.message : String(e)}` };
  }

  redirect("/");
}
