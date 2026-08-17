"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { makeQuoteService } from "@/lib/quotes/service";
import { runSubscriptionCharge } from "@/lib/subscriptions/run-charge";
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
 * client. Delegates entirely to the quote service's send() — the single
 * place quotes.status may become 'sent' — so a Resend failure never leaves
 * the quote stranded outside pending_review: send() tracks delivery via the
 * 'sent' event's resend_message_id, and pressing this button again retries
 * rather than reporting "not pending review".
 */
export async function approveAndSendQuote(quoteId: string): Promise<AdminDecisionResult> {
  if (!quoteId) return { ok: false, error: "missing quote" };

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "only rocking staff may approve quotes" };
  }

  const svc = makeQuoteService(createServiceClient());
  const res = await svc.send(quoteId, {
    id: me.profile.id,
    label: me.profile.email,
    canSend: true, // a staff member clicking in the portal, having seen the quote
  });
  if (!res.ok) return { ok: false, error: res.error };

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

/**
 * Staff-only: stop recurring billing on a quote's subscription. The cron
 * only touches 'active' rows, so this is the complete off-switch. The
 * subscription row itself (cancelled_at/by) is the audit record.
 */
export async function stopSubscription(quoteId: string): Promise<AdminDecisionResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "only rocking staff may stop billing" };
  }
  const service = createServiceClient();
  const { data: sub } = await service
    .from("quote_subscriptions")
    .select("id, status")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "no subscription on this quote" };
  const { data: flipped } = await service
    .from("quote_subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: me.profile.id })
    .eq("id", sub.id)
    .in("status", ["active", "failed"])
    .select("id")
    .maybeSingle();
  if (!flipped) return { ok: false, error: `subscription is ${sub.status} — nothing to stop` };
  revalidatePath(`/admin/quotes/${quoteId}`);
  return { ok: true };
}

/**
 * Staff-only: run the charge routine for this subscription right now (the
 * same code path as the daily cron, so behaviour cannot diverge). A 'failed'
 * subscription is reset to active first so the schedule can act on it.
 */
export async function chargeSubscriptionNow(
  quoteId: string,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    return { ok: false, error: "only rocking staff may charge" };
  }
  const service = createServiceClient();
  const { data: sub } = await service
    .from("quote_subscriptions")
    .select("id, status")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "no subscription on this quote" };
  if (sub.status === "cancelled" || sub.status === "pending_payment") {
    return { ok: false, error: `subscription is ${sub.status}` };
  }
  if (sub.status === "failed") {
    await service.from("quote_subscriptions").update({ status: "active" }).eq("id", sub.id).eq("status", "failed");
  }
  const result = await runSubscriptionCharge(sub.id);
  revalidatePath(`/admin/quotes/${quoteId}`);
  return { ok: true, result };
}
