"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ApprovalResult = { ok: true } | { ok: false; error: string };

export async function approveUser(_prev: ApprovalResult | null, formData: FormData): Promise<ApprovalResult> {
  const profileId = String(formData.get("profile_id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const role = String(formData.get("role") ?? "client_member");
  const linkDomain = formData.get("link_domain") === "on";
  if (!profileId) return { ok: false, error: "Missing user." };
  if (!clientId) return { ok: false, error: "Pick a company first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_pending_user", {
    p_profile_id: profileId,
    p_client_id: clientId,
    p_make_manager: role === "client_manager",
    p_link_domain: linkDomain,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/pending");
  return { ok: true };
}

export async function rejectUser(_prev: ApprovalResult | null, formData: FormData): Promise<ApprovalResult> {
  const profileId = String(formData.get("profile_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!profileId) return { ok: false, error: "Missing user." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_pending_user", {
    p_profile_id: profileId,
    p_reason: reason ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/pending");
  return { ok: true };
}
