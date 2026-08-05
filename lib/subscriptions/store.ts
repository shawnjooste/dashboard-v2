// Quote checkout + charge confirmation. The initial payment goes through
// Paystack hosted checkout (card-only, so the authorization is reusable);
// confirmation is idempotent and shared by the webhook (primary truth) and
// the quote page's server-side verify fallback — mirroring bookings.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { computeTotals, type QuoteDoc } from "@/lib/quotes/doc";
import { initializeTransaction } from "@/lib/paystack";
import { sendEmail } from "@/lib/email/send";
import { sendPaymentReceipt } from "@/lib/receipts";
import {
  chargeReference,
  computeInitialBreakdown,
  firstOfNextMonth,
} from "@/lib/subscriptions/billing";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const ADMIN_EMAIL = "shawn@rocking.one";
const FROM = '"Rocky @ Rocking" <quotes@send.rocking.one>';

/**
 * Begin checkout on a checkout-enabled, sent quote: compute the initial
 * charge (once-off + pro-rata, VAT once on the combined total), hold a
 * subscription row, record the charge attempt, and hand back Paystack's
 * hosted-checkout URL. Re-clicking after an abandoned checkout creates a new
 * attempt with a new reference on the same subscription row.
 */
export async function startCheckout(opts: {
  quoteId: string;
  email: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const service = createServiceClient();
  const { data: quote } = await service
    .from("quotes")
    .select("id, client_id, quote_number, status, checkout_enabled, current_version")
    .eq("id", opts.quoteId)
    .maybeSingle();
  if (!quote || !quote.checkout_enabled) return { ok: false, error: "checkout isn't enabled on this quote" };
  if (quote.status !== "sent") return { ok: false, error: "this quote isn't open for payment" };

  const { data: version } = await service
    .from("quote_versions")
    .select("doc")
    .eq("quote_id", quote.id)
    .eq("version", quote.current_version)
    .maybeSingle();
  if (!version) return { ok: false, error: "quote version not found" };

  const doc = version.doc as QuoteDoc;
  const totals = computeTotals(doc);
  const onceOffExCents = Math.round(totals.subtotal * 100);
  const monthlyExCents = Math.round((totals.revenueExVat - totals.subtotal) * 100);
  if (monthlyExCents <= 0) return { ok: false, error: "this quote has no recurring amount" };
  const monthlyVatCents = Math.round((monthlyExCents * doc.vatPercent) / 100);

  const breakdown = computeInitialBreakdown({
    onceOffExCents,
    monthlyExCents,
    vatPercent: doc.vatPercent,
    today: new Date(),
  });

  // One subscription per quote: reuse a pending hold, refuse anything live.
  const { data: existing } = await service
    .from("quote_subscriptions")
    .select("id, status")
    .eq("quote_id", quote.id)
    .maybeSingle();
  if (existing && existing.status !== "pending_payment") {
    return { ok: false, error: `a subscription already exists for this quote (${existing.status})` };
  }

  let subId = existing?.id ?? null;
  if (subId) {
    await service
      .from("quote_subscriptions")
      .update({ monthly_amount_cents: monthlyExCents, vat_cents: monthlyVatCents })
      .eq("id", subId);
  } else {
    const { data: sub, error } = await service
      .from("quote_subscriptions")
      .insert({
        quote_id: quote.id,
        client_id: quote.client_id,
        monthly_amount_cents: monthlyExCents,
        vat_cents: monthlyVatCents,
        status: "pending_payment",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    subId = sub.id;
  }

  const { data: priorInitial } = await service
    .from("quote_subscription_charges")
    .select("attempt_number")
    .eq("subscription_id", subId)
    .eq("charge_type", "initial")
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attempt = (priorInitial?.attempt_number ?? 0) + 1;
  const reference = chargeReference(subId, breakdown.billingPeriod, attempt);

  const { error: chErr } = await service.from("quote_subscription_charges").insert({
    subscription_id: subId,
    charge_type: "initial",
    billing_period: breakdown.billingPeriod,
    amount_cents: breakdown.exVatCents,
    vat_cents: breakdown.vatCents,
    paystack_reference: reference,
    attempt_number: attempt,
  });
  if (chErr) return { ok: false, error: chErr.message };

  try {
    const url = await initializeTransaction({
      email: opts.email,
      amountCents: breakdown.totalCents,
      reference,
      callbackUrl: `${APP_URL}/quotes/${quote.id}`,
      channels: ["card"], // card-only → reusable authorization
    });
    return { ok: true, url };
  } catch (e) {
    await service
      .from("quote_subscription_charges")
      .update({ status: "failed", failure_reason: "paystack initialize failed" })
      .eq("paystack_reference", reference);
    console.error("startCheckout initialize failed:", e);
    return { ok: false, error: "could not start the payment — try again shortly" };
  }
}

/**
 * Arrears recovery: hosted checkout (card-only) for the failed period's full
 * monthly amount. Paying it clears that period, captures a fresh reusable
 * authorization over the old one, and re-activates the subscription — any
 * later unpaid periods are caught up by the daily cron, whose
 * next_charge_date now lies in the past.
 */
export async function payArrears(opts: {
  quoteId: string;
  email: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const service = createServiceClient();
  const { data: sub } = await service
    .from("quote_subscriptions")
    .select("id, status, monthly_amount_cents, vat_cents, next_charge_date")
    .eq("quote_id", opts.quoteId)
    .maybeSingle();
  if (!sub || sub.status !== "failed" || !sub.next_charge_date) {
    return { ok: false, error: "there's nothing outstanding on this quote" };
  }
  const period = sub.next_charge_date;

  const { data: prior } = await service
    .from("quote_subscription_charges")
    .select("attempt_number")
    .eq("subscription_id", sub.id)
    .eq("billing_period", period)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attempt = (prior?.attempt_number ?? 0) + 1;
  const reference = chargeReference(sub.id, period, attempt);

  const { error: chErr } = await service.from("quote_subscription_charges").insert({
    subscription_id: sub.id,
    charge_type: "recurring",
    billing_period: period,
    amount_cents: sub.monthly_amount_cents,
    vat_cents: sub.vat_cents,
    paystack_reference: reference,
    attempt_number: attempt,
  });
  if (chErr) return { ok: false, error: chErr.message };

  try {
    const url = await initializeTransaction({
      email: opts.email,
      amountCents: sub.monthly_amount_cents + sub.vat_cents,
      reference,
      callbackUrl: `${APP_URL}/quotes/${opts.quoteId}`,
      channels: ["card"],
    });
    return { ok: true, url };
  } catch (e) {
    await service
      .from("quote_subscription_charges")
      .update({ status: "failed", failure_reason: "paystack initialize failed" })
      .eq("paystack_reference", reference);
    console.error("payArrears initialize failed:", e);
    return { ok: false, error: "could not start the payment — try again shortly" };
  }
}

/**
 * Flip a charge to paid once verified. Idempotent: webhook, verify-fallback
 * and duplicate deliveries all land here safely. The paid-flip is the
 * critical write; every side-effect after it is best-effort.
 *
 * Context decides the rest: a pending_payment subscription activates (and
 * the quote becomes accepted); a failed one re-activates (arrears recovery,
 * new card authorization saved); an active one needs the flip only.
 */
export async function confirmSubscriptionCharge(
  reference: string,
  amountPaidCents: number,
  auth?: { authorizationCode: string | null; customerCode: string | null; payerEmail?: string | null },
): Promise<"confirmed" | "already" | "not_found" | "underpaid"> {
  const service = createServiceClient();
  const { data: row } = await service
    .from("quote_subscription_charges")
    .select("id, subscription_id, billing_period, amount_cents, vat_cents, status, charge_type, quote_subscriptions(id, quote_id, client_id, status)")
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (!row) return "not_found";
  if (row.status === "success") return "already";
  const due = row.amount_cents + row.vat_cents;
  if (amountPaidCents < due) {
    console.error(`subscription charge ${reference}: paid ${amountPaidCents} < due ${due}`);
    return "underpaid";
  }

  const { data: flipped } = await service
    .from("quote_subscription_charges")
    .update({ status: "success", charged_at: new Date().toISOString() })
    .eq("id", row.id)
    .neq("status", "success")
    .select("id")
    .maybeSingle();
  if (!flipped) return "already";

  const sub = row.quote_subscriptions as unknown as {
    id: string; quote_id: string; client_id: string; status: string;
  } | null;
  if (!sub) return "confirmed";

  // Winning the flip above means THIS caller owns the one receipt for this
  // payment — webhook, verify-fallback and cron sweep can never double-send.
  try {
    await sendChargeReceipt(sub, {
      chargeType: row.charge_type as "initial" | "recurring",
      billingPeriod: row.billing_period,
      exVatCents: row.amount_cents,
      vatCents: row.vat_cents,
      reference,
      payerEmail: auth?.payerEmail ?? null,
    });
  } catch (e) {
    console.error("receipt failed (payment recorded):", e);
  }

  try {
    const authPatch =
      auth?.authorizationCode
        ? { paystack_authorization_code: auth.authorizationCode, paystack_customer_code: auth.customerCode }
        : {};

    if (sub.status === "pending_payment") {
      await service
        .from("quote_subscriptions")
        .update({
          ...authPatch,
          status: "active",
          activated_at: new Date().toISOString(),
          next_charge_date: firstOfNextMonth(new Date()),
        })
        .eq("id", sub.id)
        .eq("status", "pending_payment");

      // A paid checkout IS acceptance — keep the quote lifecycle consistent.
      const { data: quote } = await service
        .from("quotes")
        .select("quote_number, title, current_version")
        .eq("id", sub.quote_id)
        .maybeSingle();
      const { data: accepted } = await service
        .from("quotes")
        .update({ status: "accepted" })
        .eq("id", sub.quote_id)
        .eq("status", "sent")
        .select("id")
        .maybeSingle();
      if (accepted && quote) {
        await service.from("quote_events").insert({
          quote_id: sub.quote_id,
          version: quote.current_version,
          event: "accepted",
          comment: `Paid via checkout (ref ${reference})`,
        });
      }
      if (quote) {
        await sendEmail({
          from: FROM,
          to: [ADMIN_EMAIL],
          subject: `Quote ${quote.quote_number} PAID via checkout`,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;">
            <h2 style="margin:0 0 8px;">Checkout complete</h2>
            <p style="color:#444;">Quote <strong>${quote.quote_number}</strong> (${quote.title}) was paid —
            R ${(due / 100).toFixed(2)} incl VAT. Monthly billing starts on the 1st.</p>
            <p style="margin:20px 0 0;"><a href="${APP_URL}/admin/quotes/${sub.quote_id}"
              style="background:#D7141C;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">View the quote</a></p>
            <p style="margin:24px 0 0;color:#888;font-size:12.5px;">— Rocky</p></div>`,
          clientId: sub.client_id,
          category: "billing",
          audience: "internal",
        });
      }
    } else if (sub.status === "failed") {
      // Arrears recovery: fresh card captured; cron catches up any later
      // periods on its next run because next_charge_date lands in the past.
      await service
        .from("quote_subscriptions")
        .update({
          ...authPatch,
          status: "active",
          next_charge_date: firstOfNextMonth(new Date(row.billing_period)),
        })
        .eq("id", sub.id)
        .eq("status", "failed");
    }
    // sub.status === "active": recurring webhook backup — flip was enough.
  } catch (e) {
    console.error("subscription confirm side-effects failed (payment recorded):", e);
  }
  return "confirmed";
}


/** Month label like "August 2026" from a yyyy-mm-dd billing period. */
function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

/** Receipt for a successful subscription charge — payer + accounts@ copied.
 *  Exported for the cron's synchronous success path (run-charge). */
export async function sendChargeReceipt(
  sub: { quote_id: string; client_id: string },
  charge: {
    chargeType: "initial" | "recurring";
    billingPeriod: string;
    exVatCents: number;
    vatCents: number;
    reference: string;
    payerEmail: string | null;
  },
): Promise<void> {
  const service = createServiceClient();
  const [{ data: quote }, { data: client }] = await Promise.all([
    service.from("quotes").select("quote_number, title").eq("id", sub.quote_id).maybeSingle(),
    service.from("clients").select("name").eq("id", sub.client_id).maybeSingle(),
  ]);
  let to = charge.payerEmail;
  if (!to) {
    const { data: mgr } = await service
      .from("profiles")
      .select("email")
      .eq("client_id", sub.client_id)
      .eq("role", "client_manager")
      .eq("status", "active")
      .order("email")
      .limit(1)
      .maybeSingle();
    to = mgr?.email ?? null;
  }
  if (!to || !quote) {
    console.error("receipt skipped — no recipient or quote:", charge.reference);
    return;
  }
  await sendPaymentReceipt({
    clientId: sub.client_id,
    clientName: client?.name ?? "your company",
    toEmail: to,
    quoteNumber: quote.quote_number,
    quoteTitle: quote.title,
    description:
      charge.chargeType === "initial"
        ? `Quote payment — once-off items plus pro-rata for ${periodLabel(charge.billingPeriod)}`
        : `Monthly service — ${periodLabel(charge.billingPeriod)}`,
    exVatCents: charge.exVatCents,
    vatCents: charge.vatCents,
    reference: charge.reference,
    paidAt: new Date(),
  });
}
