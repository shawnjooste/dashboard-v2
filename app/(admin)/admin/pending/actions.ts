"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function approveUser(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const makeManager = formData.get("make_manager") === "on";
  if (!profileId || !clientId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_pending_user", {
    p_profile_id: profileId,
    p_client_id: clientId,
    p_make_manager: makeManager,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pending");
}
