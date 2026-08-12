"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createServiceClient } from "@/lib/supabase/service";
import { buildEnquiry } from "@/lib/connectivity-enquiry";
import { notifyRfqCreated } from "@/lib/rfq-notify";

export type EnquiryResult = { ok: true } | { ok: false; error: string };

/**
 * A client asks us to check connectivity at their address; we raise an RFQ.
 *
 * `rfqs` is staff-only under RLS, so this writes with the service client —
 * which makes every guard below the security boundary, not a convenience:
 * the caller must be an authenticated client user who can see Connectivity,
 * and `client_id` comes from their session profile, never from the form. A
 * client can only ever raise an enquiry for their own company.
 */
export async function submitConnectivityEnquiry(
  _prev: EnquiryResult | null,
  formData: FormData,
): Promise<EnquiryResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.client_id) {
    return { ok: false, error: "Sign in with your company account to send an enquiry." };
  }
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) {
    return { ok: false, error: "Connectivity is not enabled for your account." };
  }
  const clientId = me.profile.client_id;
  const service = createServiceClient();

  const { data: client } = await service.from("clients").select("name").eq("id", clientId).maybeSingle();
  const built = buildEnquiry(client?.name ?? "your company", {
    address: String(formData.get("address") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    speed: String(formData.get("speed") ?? ""),
    note: String(formData.get("note") ?? ""),
    contactName: String(formData.get("contact_name") ?? ""),
    contactEmail: String(formData.get("contact_email") ?? ""),
  });
  if (!built.ok) return { ok: false, error: built.error };

  // Rate limit: one open enquiry per client, so an eager click can't litter
  // the RFQ board. Matched on client + status + the title we generate, never
  // on anything the submitter controls.
  const { data: existing, error: existingErr } = await service
    .from("rfqs")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "new")
    .eq("title", built.payload.title)
    .limit(1);
  if (existingErr) return { ok: false, error: "Something went wrong sending that — please try again." };
  if (existing && existing.length > 0) {
    return { ok: false, error: "We already have your enquiry — we'll come back to you shortly." };
  }

  const { data: rfq, error } = await service
    .from("rfqs")
    .insert({
      title: built.payload.title,
      client_id: clientId,
      requested_by: built.payload.requestedBy,
      description: built.payload.description,
      status: "new",
    })
    .select("id")
    .single();
  if (error) {
    console.error("connectivity enquiry insert failed:", error);
    return { ok: false, error: "Something went wrong sending that — please try again." };
  }

  // Best-effort: Shawn hears about it, but a mail failure never loses the RFQ.
  try {
    await notifyRfqCreated({
      rfqId: rfq.id,
      title: built.payload.title,
      clientLabel: client?.name ?? null,
      requestedBy: built.payload.requestedBy,
      description: built.payload.description,
      creatorEmail: me.profile.email,
    });
  } catch (e) {
    console.error("connectivity enquiry notification failed:", e);
  }

  revalidatePath("/connectivity");
  return { ok: true };
}
