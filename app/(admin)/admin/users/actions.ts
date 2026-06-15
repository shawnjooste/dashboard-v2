"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { revalidatePath } from "next/cache";

const ROLES = new Set(["client_manager", "client_member"]);

/**
 * Staff-only: promote or demote a client user's portal role from the Users list.
 * The work and the real guard live in the set_portal_role RPC (staff-checked,
 * never touches rocking_staff); the check here is defence in depth.
 */
export async function setPortalRole(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!profileId || !ROLES.has(role)) throw new Error("invalid request");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may change portal roles");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_portal_role", {
    p_profile_id: profileId,
    p_role: role as "client_manager" | "client_member",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}
