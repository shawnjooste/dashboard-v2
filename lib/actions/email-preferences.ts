"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

/** Turn Portal Updates on or off for one person. Staff may set it for any
 *  client user; anyone else may only set their own. Never affects
 *  transactional email — see lib/email/suppression.ts. */
export async function setPortalUpdateOptOut(profileId: string, optOut: boolean) {
  const me = await getCurrentProfile();
  if (!me.authenticated) throw new Error("not signed in");
  const isStaff = me.profile.role === "rocking_staff";
  if (!isStaff && profileId !== me.profile.id) {
    throw new Error("you can only change your own email preferences");
  }
  const service = createServiceClient();
  let q = service.from("profiles").update({ portal_updates_opt_out: optOut }).eq("id", profileId);
  // A client-surface caller may only ever touch their own row; staff may not
  // flip this on a rocking_staff profile from here either.
  if (!isStaff) q = q.eq("id", me.profile.id);
  else q = q.in("role", ["client_manager", "client_member"]);
  const { error } = await q;
  if (error) throw new Error(error.message);
  revalidatePath("/communications");
  revalidatePath("/admin/users");
}
