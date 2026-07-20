"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { isExpired } from "@/lib/quotes/doc";
import { notifyQuoteDecision } from "@/lib/quote-emails";

type Decision = "accepted" | "rejected" | "changes_requested";

/**
 * Records a manager's decision on a quote. First click wins: the status flip
 * is a single conditional UPDATE (status must still be 'sent'); a losing
 * concurrent click changes nothing. Email failures never block the decision.
 */
async function decide(quoteId: string, decision: Decision, comment: string | null) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "client_manager" || !me.profile.client_id) {
    throw new Error("only client managers can act on quotes");
  }
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "quotes")) {
    throw new Error("quotes are not enabled for your account");
  }

  const service = createServiceClient();
  const { data: quote } = await service
    .from("quotes")
    .select("id, client_id, quote_number, title, status, current_version")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote || quote.client_id !== me.profile.client_id) throw new Error("quote not found");
  if (quote.status !== "sent") throw new Error("this quote has already been decided");

  const { data: version } = await service
    .from("quote_versions")
    .select("valid_until")
    .eq("quote_id", quoteId)
    .eq("version", quote.current_version)
    .maybeSingle();
  if (decision === "accepted" && isExpired(version?.valid_until ?? null)) {
    throw new Error("this quote has expired — ask us for a refreshed one");
  }

  // Atomic: only flips if still 'sent'. Losing click gets no row back.
  const { data: updated } = await service
    .from("quotes")
    .update({ status: decision })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (!updated) throw new Error("another manager just decided this quote");

  await service.from("quote_events").insert({
    quote_id: quoteId,
    version: quote.current_version,
    event: decision,
    actor_profile_id: me.profile.id,
    comment,
  });

  try {
    await notifyQuoteDecision({
      clientId: quote.client_id,
      quoteId,
      quoteNumber: quote.quote_number,
      title: quote.title,
      decision,
      actorEmail: me.profile.email,
      comment,
    });
  } catch (e) {
    console.error("quote decision email failed:", e);
  }

  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
}

export async function acceptQuote(quoteId: string) {
  await decide(quoteId, "accepted", null);
}

export async function declineQuote(quoteId: string, formData: FormData) {
  await decide(quoteId, "rejected", String(formData.get("comment") ?? "").trim() || null);
}

export async function requestChanges(quoteId: string, formData: FormData) {
  const comment = String(formData.get("comment") ?? "").trim();
  if (!comment) throw new Error("tell us what you'd like changed");
  await decide(quoteId, "changes_requested", comment);
}
