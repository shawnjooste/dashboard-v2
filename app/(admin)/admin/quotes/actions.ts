"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
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
  const { data: updated } = await service
    .from("quotes")
    .update({ status: decision })
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
