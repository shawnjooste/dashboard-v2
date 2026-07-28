"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { notifyQuoteSent } from "@/lib/quote-emails";
import { fmtMoney } from "@/lib/quotes/doc";
import { revalidatePath } from "next/cache";

/**
 * Staff-only: mark an accepted quote as invoiced (or clear it). Stamps
 * invoiced_at so the admin quotes worklist separates "to invoice" from done.
 */
export async function setQuoteInvoiced(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const invoiced = formData.get("invoiced") === "true";
  if (!quoteId) throw new Error("missing quote");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may update invoicing");
  }

  const service = createServiceClient();
  const { error } = await service
    .from("quotes")
    .update({ invoiced_at: invoiced ? new Date().toISOString() : null })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/quotes");
}

export type AdminDecisionResult = { ok: true } | { ok: false; error: string };

/**
 * Staff-only: approve a pending-review quote (built by the automated
 * inbound-email pipeline, not yet seen by a human) and send it to the
 * client. Atomic flip guards against double-approval; the actual send
 * reuses notifyQuoteSent so behaviour matches an interactively-created
 * quote (CC, Rocky sign-off, resend_message_id capture for reply-matching).
 */
export async function approveAndSendQuote(quoteId: string): Promise<AdminDecisionResult> {
  if (!quoteId) return { ok: false, error: "missing quote" };

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "only rocking staff may approve quotes" };
  }

  const service = createServiceClient();
  const { data: quote } = await service
    .from("quotes")
    .select("id, client_id, quote_number, title, current_version, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote) return { ok: false, error: "quote not found" };
  if (quote.status !== "pending_review") return { ok: false, error: "this quote isn't pending review" };

  const { data: version } = await service
    .from("quote_versions")
    .select("grand_total, monthly_total")
    .eq("quote_id", quoteId)
    .eq("version", quote.current_version)
    .maybeSingle();

  // Atomic: only flips from pending_review; a losing concurrent click no-ops.
  const { data: updated } = await service
    .from("quotes")
    .update({ status: "sent" })
    .eq("id", quoteId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "this quote was just approved elsewhere" };

  await service.from("quote_events").insert({
    quote_id: quoteId,
    version: quote.current_version,
    event: "sent",
    actor_profile_id: me.profile.id,
    comment: `Approved and sent by ${me.profile.email}`,
  });

  try {
    await notifyQuoteSent({
      clientId: quote.client_id,
      quoteId,
      quoteNumber: quote.quote_number,
      version: quote.current_version,
      title: quote.title,
      grandTotal: fmtMoney(version?.grand_total ?? null),
      isRevision: false,
    });
  } catch (e) {
    console.error("approve-and-send quote email failed:", e);
    return { ok: false, error: "quote approved but the client email failed to send — check Resend" };
  }

  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/quotes");
  return { ok: true };
}

/**
 * Staff-only: record an accept/reject on a quote on the client's behalf (e.g.
 * the client confirmed by phone). Mirrors the client decide() flow but the
 * actor is the staff member and the event is tagged "on behalf of client".
 * Allowed from a decidable state (sent or changes_requested); the atomic flip
 * means a concurrent client click can't double-decide. No client email is sent.
 */
export async function adminDecideQuote(
  quoteId: string,
  decision: "accepted" | "rejected",
  comment: string | null,
  poNumber: string | null = null,
): Promise<AdminDecisionResult> {
  if (!quoteId) return { ok: false, error: "missing quote" };
  if (decision !== "accepted" && decision !== "rejected") return { ok: false, error: "invalid decision" };

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "only rocking staff may decide quotes" };
  }

  const service = createServiceClient();
  const { data: quote } = await service
    .from("quotes")
    .select("id, current_version, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote) return { ok: false, error: "quote not found" };
  if (quote.status !== "sent" && quote.status !== "changes_requested") {
    return { ok: false, error: "this quote has already been decided" };
  }

  // Atomic: only flips from a decidable state; a losing concurrent click no-ops.
  const patch: { status: "accepted" | "rejected"; po_number?: string | null } = { status: decision };
  if (decision === "accepted" && poNumber?.trim()) patch.po_number = poNumber.trim();
  const { data: updated } = await service
    .from("quotes")
    .update(patch)
    .eq("id", quoteId)
    .in("status", ["sent", "changes_requested"])
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "this quote was just decided elsewhere" };

  const reason = comment?.trim();
  await service.from("quote_events").insert({
    quote_id: quoteId,
    version: quote.current_version,
    event: decision,
    actor_profile_id: me.profile.id,
    comment: reason ? `On behalf of client — ${reason}` : "Recorded by Rocking on behalf of the client",
  });

  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/quotes");
  return { ok: true };
}
