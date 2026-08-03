// The per-subscription charge routine — ONE implementation shared by the
// daily cron and the admin "Charge now" button, so the two can never diverge.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { chargeAuthorization, verifyTransaction } from "@/lib/paystack";
import { sendEmail } from "@/lib/email/send";
import { confirmSubscriptionCharge } from "@/lib/subscriptions/store";
import {
  MAX_ATTEMPTS,
  chargeReference,
  decideCharge,
  firstOfNextMonth,
  type ChargeRow,
} from "@/lib/subscriptions/billing";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const ADMIN_EMAIL = "shawn@rocking.one";
const FROM = '"Rocky @ Rocking" <quotes@send.rocking.one>';

export type RunResult = "charged" | "retry_failed" | "exhausted" | "advanced" | "waiting" | "skipped";

/**
 * Process one subscription's due period: charge, retry, advance, or flag.
 * Declines are recorded and retried on the day-1/3/5 schedule; after the
 * third failure the subscription flips to 'failed' and Shawn + the client
 * are each emailed once. Service is NEVER suspended automatically.
 */
export async function runSubscriptionCharge(subscriptionId: string, today = new Date()): Promise<RunResult> {
  const service = createServiceClient();
  const { data: sub } = await service
    .from("quote_subscriptions")
    .select("id, quote_id, client_id, status, monthly_amount_cents, vat_cents, next_charge_date, paystack_authorization_code")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (!sub || sub.status !== "active" || !sub.next_charge_date) return "skipped";
  const period = sub.next_charge_date;
  if (period > today.toISOString().slice(0, 10)) return "skipped";

  const { data: charges } = await service
    .from("quote_subscription_charges")
    .select("billing_period, status, attempt_number, created_at, paystack_reference")
    .eq("subscription_id", sub.id)
    .eq("billing_period", period);

  // Settle stale in-flight rows first (a transport error can leave a charge
  // whose outcome we never saw): verify with Paystack and record the truth.
  for (const c of charges ?? []) {
    if (c.status === "pending" && Date.now() - new Date(c.created_at).getTime() > 60 * 60 * 1000) {
      try {
        const v = await verifyTransaction(c.paystack_reference);
        if (v.paid) {
          await confirmSubscriptionCharge(c.paystack_reference, v.amountCents);
          c.status = "success";
        } else {
          await service
            .from("quote_subscription_charges")
            .update({ status: "failed", failure_reason: "unresolved — not completed" })
            .eq("paystack_reference", c.paystack_reference)
            .eq("status", "pending");
          c.status = "failed";
        }
      } catch (e) {
        console.error("stale-pending verify failed:", c.paystack_reference, e);
      }
    }
  }

  const decision = decideCharge((charges ?? []) as ChargeRow[], today);

  if (decision.action === "advance") {
    await service
      .from("quote_subscriptions")
      .update({ next_charge_date: firstOfNextMonth(new Date(period)) })
      .eq("id", sub.id);
    return "advanced";
  }
  if (decision.action === "wait") return "waiting";
  if (decision.action === "exhausted") {
    await flagExhausted(sub, period);
    return "exhausted";
  }

  // decision.action === "charge"
  if (!sub.paystack_authorization_code) {
    console.error(`subscription ${sub.id}: active with no stored authorization`);
    return "skipped";
  }
  const { data: managers } = await service
    .from("profiles")
    .select("email")
    .eq("client_id", sub.client_id)
    .eq("role", "client_manager")
    .eq("status", "active")
    .order("email");
  const chargeEmail = managers?.[0]?.email ?? ADMIN_EMAIL;

  const reference = chargeReference(sub.id, period, decision.attempt);
  const amountIncl = sub.monthly_amount_cents + sub.vat_cents;
  const { error: insErr } = await service.from("quote_subscription_charges").insert({
    subscription_id: sub.id,
    charge_type: "recurring",
    billing_period: period,
    amount_cents: sub.monthly_amount_cents,
    vat_cents: sub.vat_cents,
    paystack_reference: reference,
    attempt_number: decision.attempt,
  });
  if (insErr) {
    // Unique-reference collision means another run already owns this attempt.
    console.error("charge row insert failed:", insErr.message);
    return "waiting";
  }

  let result: { success: boolean; failureReason: string | null };
  try {
    result = await chargeAuthorization({
      email: chargeEmail,
      amountCents: amountIncl,
      reference,
      authorizationCode: sub.paystack_authorization_code,
    });
  } catch (e) {
    // Transport/API error: outcome unknown — leave the row pending; the
    // stale-pending sweep verifies and settles it on the next run.
    console.error("charge_authorization transport error:", reference, e);
    return "waiting";
  }

  if (result.success) {
    await service
      .from("quote_subscription_charges")
      .update({ status: "success", charged_at: new Date().toISOString() })
      .eq("paystack_reference", reference)
      .eq("status", "pending");
    await service
      .from("quote_subscriptions")
      .update({ next_charge_date: firstOfNextMonth(new Date(period)) })
      .eq("id", sub.id);
    return "charged";
  }

  await service
    .from("quote_subscription_charges")
    .update({ status: "failed", failure_reason: result.failureReason })
    .eq("paystack_reference", reference)
    .eq("status", "pending");
  if (decision.attempt >= MAX_ATTEMPTS) {
    await flagExhausted(sub, period);
    return "exhausted";
  }
  return "retry_failed";
}

async function flagExhausted(
  sub: { id: string; quote_id: string; client_id: string; monthly_amount_cents: number; vat_cents: number },
  period: string,
): Promise<void> {
  const service = createServiceClient();
  const { data: flipped } = await service
    .from("quote_subscriptions")
    .update({ status: "failed" })
    .eq("id", sub.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!flipped) return; // already flagged — emails were sent by that flip

  const { data: quote } = await service
    .from("quotes")
    .select("quote_number, title")
    .eq("id", sub.quote_id)
    .maybeSingle();
  const { data: managers } = await service
    .from("profiles")
    .select("email")
    .eq("client_id", sub.client_id)
    .eq("role", "client_manager")
    .eq("status", "active");
  const amount = ((sub.monthly_amount_cents + sub.vat_cents) / 100).toFixed(2);
  const label = quote ? `${quote.quote_number} (${quote.title})` : sub.quote_id;

  try {
    await sendEmail({
      from: FROM,
      to: [ADMIN_EMAIL],
      subject: `Recurring charge failing — ${quote?.quote_number ?? sub.quote_id}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;">
        <h2 style="margin:0 0 8px;">Monthly charge failed 3 times</h2>
        <p style="color:#444;">${label}: R ${amount} incl VAT for ${period.slice(0, 7)} could not be
        collected after three attempts. The client has been asked to update their card.
        No service has been suspended.</p>
        <p style="margin:20px 0 0;"><a href="${APP_URL}/admin/quotes/${sub.quote_id}"
          style="background:#D7141C;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">View the quote</a></p>
        <p style="margin:24px 0 0;color:#888;font-size:12.5px;">— Rocky</p></div>`,
      clientId: sub.client_id,
      category: "billing",
      audience: "internal",
    });
    const to = (managers ?? []).map((m) => m.email);
    if (to.length) {
      await sendEmail({
        from: FROM,
        to,
        subject: `Payment failed — ${quote?.quote_number ?? "your monthly service"}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;">
          <h2 style="margin:0 0 8px;">We couldn't process your monthly payment</h2>
          <p style="color:#444;">The monthly payment of R ${amount} incl VAT for
          <strong>${quote?.title ?? "your service"}</strong> didn't go through after several
          attempts — the card on file may have expired. Your service is unaffected.</p>
          <p style="margin:20px 0 0;"><a href="${APP_URL}/quotes/${sub.quote_id}/pay"
            style="background:#D7141C;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">Update your card &amp; settle</a></p>
          <p style="margin:24px 0 0;color:#888;font-size:12.5px;">— Rocky</p></div>`,
        clientId: sub.client_id,
        category: "billing",
        audience: "client",
      });
    }
  } catch (e) {
    console.error("exhausted-flag emails failed:", e);
  }
}
