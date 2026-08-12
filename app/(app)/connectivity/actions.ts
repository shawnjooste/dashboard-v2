"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createServiceClient } from "@/lib/supabase/service";
import { buildEnquiry } from "@/lib/connectivity-enquiry";
import { notifyRfqCreated } from "@/lib/rfq-notify";

export type EnquiryResult = { ok: true } | { ok: false; error: string };

const ALREADY = "We already have your enquiry — we'll come back to you shortly.";
const GENERIC = "Something went wrong sending that — please try again.";

/** A form part can be a File, and String(File) is "[object File]" — long
 *  enough to slip past a length check. Anything not a string is not input. */
function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

/**
 * A client asks us to check connectivity at their address; we raise an RFQ.
 *
 * `rfqs` is staff-only under RLS, so this writes with the service client —
 * which makes every guard below the security boundary, not a convenience:
 * the caller must be an active client user who can see Connectivity, and
 * `client_id` comes from their session profile, never from the form. A client
 * can only ever raise an enquiry for their own company.
 *
 * The one-open-enquiry rule is enforced by a partial unique index
 * (0087_one_open_connectivity_enquiry), not by the pre-check below: a server
 * action is a POST endpoint anyone signed in can hammer concurrently, and a
 * check-then-insert pair would let a burst through. The pre-check exists only
 * to give a friendly message on the common path.
 */
export async function submitConnectivityEnquiry(
  _prev: EnquiryResult | null,
  formData: FormData,
): Promise<EnquiryResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.client_id) {
    return { ok: false, error: "Sign in with your company account to send an enquiry." };
  }
  // Defence in depth. Today a non-active user has no client_id so the check
  // above already catches them — but that is a coincidence of the signup
  // trigger, not a guarantee, and this is a service-role write.
  if (me.profile.status !== "active") {
    return { ok: false, error: "Your account isn't active yet." };
  }
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) {
    return { ok: false, error: "Connectivity is not enabled for your account." };
  }
  const clientId = me.profile.client_id;
  const service = createServiceClient();

  // The name goes into the title, which is the dedupe key — so a failed read
  // must not quietly produce a differently-titled row that never dedupes.
  const { data: client, error: clientErr } = await service
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client?.name) return { ok: false, error: GENERIC };

  const built = buildEnquiry(client.name, {
    address: field(formData, "address"),
    provider: field(formData, "provider"),
    speed: field(formData, "speed"),
    note: field(formData, "note"),
    contactName: field(formData, "contact_name"),
    contactEmail: field(formData, "contact_email"),
  });
  if (!built.ok) return { ok: false, error: built.error };

  const { data: existing, error: existingErr } = await service
    .from("rfqs")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "new")
    .eq("title", built.payload.title)
    .limit(1);
  if (existingErr) return { ok: false, error: GENERIC };
  if (existing && existing.length > 0) return { ok: false, error: ALREADY };

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
    // 23505: the partial unique index caught a concurrent submit. Same
    // outcome as the pre-check, so say the same thing.
    if (error.code === "23505") return { ok: false, error: ALREADY };
    console.error("connectivity enquiry insert failed:", error);
    return { ok: false, error: GENERIC };
  }

  // Audit: tie the row to the authenticated profile that raised it.
  // `requested_by` holds only the self-declared contact. Best-effort.
  await service.from("rfq_events").insert({
    rfq_id: rfq.id,
    kind: "created",
    body: `Raised from the portal's Connectivity page by ${me.profile.email}`,
    posted_by_profile_id: me.profile.id,
  });

  // Best-effort: Shawn hears about it, but a mail failure never loses the RFQ.
  try {
    await notifyRfqCreated({
      rfqId: rfq.id,
      title: built.payload.title,
      clientLabel: client.name,
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
