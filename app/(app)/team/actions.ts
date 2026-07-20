"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { sendOnboardingEmail } from "@/lib/notify";
import { supportOnboardingContent } from "@/lib/onboarding-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

export type InviteTeamResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Manager-only: add a team member from the SAME email domain to the manager's
 * OWN client, as a member. The domain match + forced client_id/role are the
 * security boundary — a manager can never invite outside their company, choose a
 * different client, or mint a manager/staff account.
 */
export async function inviteTeamMember(
  _prev: InviteTeamResult | null,
  formData: FormData,
): Promise<InviteTeamResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "client_manager" || !me.profile.client_id) {
    return { ok: false, error: "Only an account manager can add team members." };
  }
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "team")) {
    return { ok: false, error: "Team management is not enabled for your account." };
  }

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!first) return { ok: false, error: "Enter the team member's first name." };
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };

  // Domain guard — invitee must share the manager's email domain.
  const myDomain = me.profile.email.split("@")[1]?.toLowerCase();
  const theirDomain = email.split("@")[1]?.toLowerCase();
  if (!myDomain || theirDomain !== myDomain) {
    return { ok: false, error: `You can only add people with an @${myDomain ?? "your company"} email address.` };
  }

  const clientId = me.profile.client_id;
  const name = [first, last].filter(Boolean).join(" ");
  const service = createServiceClient();

  // Provision a passwordless user. If they already exist, stop — don't silently re-grant.
  const link = await service.auth.admin.generateLink({ type: "invite", email });
  if (link.error) {
    return { ok: false, error: "That person already has portal access." };
  }
  const userId = link.data?.user?.id;
  const tokenHash = link.data?.properties?.hashed_token;
  if (!userId || !tokenHash) {
    return { ok: false, error: "Could not create a sign-in link for that address." };
  }

  // Assign to the manager's OWN client as an active member (defence in depth over
  // the domain auto-assign trigger). Never another client, never manager/staff.
  await service.from("profiles").update({ client_id: clientId, status: "active", role: "client_member" }).eq("id", userId);

  // Name the linked person (the link_profile_person trigger creates it from client_id).
  const { data: prof } = await service.from("profiles").select("person_id").eq("id", userId).maybeSingle();
  if (prof?.person_id) {
    await service.from("people").update({ display_name: name || email.split("@")[0] }).eq("id", prof.person_id);
  }

  const { data: client } = await service.from("clients").select("name").eq("id", clientId).maybeSingle();
  const company = client?.name ?? "your company";
  const portalUrl = `${APP_URL}/auth/confirm?token_hash=${tokenHash}&type=invite&next=/`;
  try {
    await sendOnboardingEmail({
      to: email,
      firstName: first,
      companyName: company,
      portalUrl,
      clientId: me.profile.client_id,
      ...supportOnboardingContent(company),
    });
  } catch (e) {
    console.error("team invite email failed:", e);
    return { ok: false, error: "Added, but the welcome email didn't send — they can still sign in at the portal." };
  }

  revalidatePath("/team");
  return { ok: true, email };
}
