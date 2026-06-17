"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { sendOnboardingEmail } from "@/lib/notify";
import { revalidatePath } from "next/cache";

const ROLES = new Set(["client_manager", "client_member"]);
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

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

export type InviteResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Staff-only: invite someone to a client. Provisions a passwordless user,
 * assigns them to the chosen client (via the staff-guarded approve RPC), then
 * emails them a one-click magic link with the branded onboarding template.
 */
export async function inviteUser(_prev: InviteResult | null, formData: FormData): Promise<InviteResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const clientId = String(formData.get("client_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (!clientId) return { ok: false, error: "Pick a client." };

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "Only Rocking staff may invite users." };
  }

  const service = createServiceClient();

  // A passwordless sign-in link. 'invite' creates a new user; if the address
  // already exists, fall back to a magic link for the existing one.
  let linkType: "invite" | "magiclink" = "invite";
  let link = await service.auth.admin.generateLink({ type: "invite", email });
  if (link.error) {
    linkType = "magiclink";
    link = await service.auth.admin.generateLink({ type: "magiclink", email });
  }
  const userId = link.data?.user?.id;
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !userId || !tokenHash) {
    return { ok: false, error: "Could not create a sign-in link for that address." };
  }

  // Assign to the chosen client and activate (staff-guarded; runs as the admin).
  const supabase = await createClient();
  const { error: assignErr } = await supabase.rpc("approve_pending_user", {
    p_profile_id: userId,
    p_client_id: clientId,
    p_make_manager: false,
  });
  if (assignErr) return { ok: false, error: assignErr.message };

  // If a name was given, set it on the person now (approve linked the person),
  // so the invitee skips the first-login name step.
  if (name) {
    const parts = name.split(/\s+/);
    const { data: prof } = await service
      .from("profiles")
      .select("person_id")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.person_id) {
      await service
        .from("people")
        .update({ first_name: parts[0], last_name: parts.slice(1).join(" ") || null, display_name: name })
        .eq("id", prof.person_id);
    }
  }

  const { data: client } = await service
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();

  const portalUrl = `${APP_URL}/auth/confirm?token_hash=${tokenHash}&type=${linkType}&next=/`;
  const firstName = (name ? name.split(/\s+/)[0] : email.split("@")[0]) || "there";

  try {
    await sendOnboardingEmail({
      to: email,
      firstName,
      companyName: client?.name ?? "your company",
      portalUrl,
    });
  } catch (e) {
    console.error("onboarding email failed:", e);
    return { ok: false, error: "User set up, but the email failed to send — try again." };
  }

  revalidatePath("/admin/users");
  return { ok: true, email };
}
