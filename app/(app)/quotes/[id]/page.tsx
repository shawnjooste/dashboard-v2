import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createServiceClient } from "@/lib/supabase/service";
import { getQuoteDetail } from "@/lib/views/quotes";
import { computeTotals, fmtMoney, STATUS_LABEL } from "@/lib/quotes/doc";
import { notifyQuoteViewed } from "@/lib/quote-emails";
import { computeInitialBreakdown } from "@/lib/subscriptions/billing";
import { confirmSubscriptionCharge } from "@/lib/subscriptions/store";
import { getSubscriptionForQuote } from "@/lib/views/subscriptions";
import { verifyTransaction } from "@/lib/paystack";
import { QuoteDocument } from "@/components/QuoteDocument";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { PageHeader } from "@/components/ui";
import { QuoteActions } from "./QuoteActions";

/** Logs the first time each manager opens the quote (audit: "has it been seen?").
 *  Returns true if this call recorded a new (first) view. */
async function logViewed(quoteId: string, version: number, profileId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data: prior } = await service
    .from("quote_events")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("event", "viewed")
    .eq("actor_profile_id", profileId)
    .limit(1)
    .maybeSingle();
  if (prior) return false;
  await service.from("quote_events").insert({
    quote_id: quoteId,
    version,
    event: "viewed",
    actor_profile_id: profileId,
  });
  return true;
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "quotes")) redirect("/");
  if (me.profile.role !== "client_manager") redirect("/");

  // Landing back from Paystack: server-side verify fallback (the webhook is
  // the primary truth; this covers a delayed or missed delivery so the page
  // reflects the payment immediately).
  const sp = await searchParams;
  const ref = [sp.reference, sp.trxref].flat().find((r) => typeof r === "string" && r.startsWith("qs-"));
  if (ref) {
    try {
      const v = await verifyTransaction(ref);
      if (v.paid) {
        await confirmSubscriptionCharge(ref, v.amountCents, {
          authorizationCode: v.authorizationCode,
          customerCode: v.customerCode,
          payerEmail: v.customerEmail,
        });
      }
    } catch (e) {
      console.error("checkout verify fallback failed:", e);
    }
  }

  const quote = await getQuoteDetail(id);
  if (!quote) {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Quote not found.{" "}
          <Link href="/quotes" className="text-brand hover:text-brand-dark">← All quotes</Link>
        </p>
      </div>
    );
  }

  const isFirstView = await logViewed(quote.id, quote.version, me.profile.id);
  if (isFirstView) {
    try {
      await notifyQuoteViewed({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        title: quote.title,
        clientName: quote.doc.client.name,
        viewerEmail: me.profile.email,
      });
    } catch (e) {
      console.error("quote viewed email failed:", e);
    }
  }

  const subscription = quote.checkoutEnabled ? await getSubscriptionForQuote(quote.id) : null;

  // Checkout breakdown, computed server-side at render. The action recomputes
  // at click time — the only divergence window is a midnight boundary.
  let checkout: {
    onceOff: string; proRata: string; periodStart: string | null; periodEnd: string | null;
    monthlyIncl: string | null; totalIncl: string;
  } | null = null;
  if (quote.checkoutEnabled && quote.status === "sent" && (!subscription || subscription.status === "pending_payment")) {
    const totals = computeTotals(quote.doc);
    const onceOffExCents = Math.round(totals.subtotal * 100);
    const monthlyExCents = Math.round((totals.revenueExVat - totals.subtotal) * 100);
    if (monthlyExCents > 0 || onceOffExCents > 0) {
      const b = computeInitialBreakdown({
        onceOffExCents, monthlyExCents, vatPercent: quote.doc.vatPercent, today: new Date(),
      });
      const monthlyIncl = monthlyExCents + Math.round((monthlyExCents * quote.doc.vatPercent) / 100);
      checkout = {
        onceOff: fmtMoney(b.onceOffCents / 100),
        proRata: fmtMoney(b.proRataCents / 100),
        // null monthly = once-off-only checkout: no pro-rata, nothing recurs.
        periodStart: monthlyExCents > 0 ? b.periodStart : null,
        periodEnd: monthlyExCents > 0 ? b.periodEnd : null,
        monthlyIncl: monthlyExCents > 0 ? fmtMoney(monthlyIncl / 100) : null,
        totalIncl: fmtMoney(b.totalCents / 100),
      };
    }
  }

  const decidedBanner =
    !subscription &&
    quote.decision &&
    (quote.status === "accepted" || quote.status === "rejected" || quote.status === "changes_requested");

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <PageHeader
          breadcrumb={
            <Link href="/quotes" className="underline underline-offset-2 hover:text-ink">
              Quotes
            </Link>
          }
          title={quote.title}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <span>{quote.quoteNumber}</span>
              <QuoteStatusPill status={quote.status} />
            </span>
          }
        />
      </div>

      {subscription && subscription.status === "active" && subscription.monthlyInclCents > 0 && (
        <div className="rounded-lg border border-good-line bg-good-tint px-4 py-3 text-sm text-good print:hidden">
          <strong>Active</strong> — {fmtMoney(subscription.monthlyInclCents / 100)} incl VAT is billed
          automatically on the 1st of each month.
          {subscription.nextChargeDate ? <> Next billing date: {subscription.nextChargeDate}.</> : null}
        </div>
      )}

      {subscription && subscription.status === "active" && subscription.monthlyInclCents === 0 && (
        <div className="rounded-lg border border-good-line bg-good-tint px-4 py-3 text-sm text-good print:hidden">
          <strong>Paid</strong> — this quote was settled by card. Thank you! A receipt has been emailed.
        </div>
      )}

      {subscription && subscription.status === "failed" && (
        <div className="rounded-lg border border-warn-line bg-warn-tint-2 px-4 py-3 text-sm text-warn-ink print:hidden">
          <strong>Payment problem</strong> — your last monthly payment didn&apos;t go through.{" "}
          <Link href={`/quotes/${quote.id}/pay`} className="font-semibold underline underline-offset-2">
            Update your card and settle the outstanding amount
          </Link>
          .
        </div>
      )}

      {decidedBanner && quote.decision && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm print:hidden ${
            quote.status === "accepted"
              ? "border-good-line bg-good-tint text-good"
              : quote.status === "rejected"
                ? "border-line bg-brand-tint text-brand"
                : "border-warn-line bg-warn-tint-2 text-warn-ink"
          }`}
        >
          <strong>{STATUS_LABEL[quote.status]}</strong> by {quote.decision.actorName ?? "a manager"} on{" "}
          {quote.decision.at.slice(0, 10)}
          {quote.decision.comment ? <> — &ldquo;{quote.decision.comment}&rdquo;</> : null}
          {quote.status === "accepted" && quote.poNumber ? <> — PO {quote.poNumber}</> : null}
          {quote.status === "changes_requested" && (
            <span className="block pt-1 text-warn-ink/80">
              We&apos;re on it — a revised version will land here and you&apos;ll get an email.
            </span>
          )}
        </div>
      )}

      {quote.status === "expired" && (
        <div className="rounded-lg border border-line bg-line-soft px-4 py-3 text-sm text-ink-3 print:hidden">
          This quote has expired. If you&apos;re still interested, ask us for a refreshed version —
          pricing may have moved.
        </div>
      )}

      <QuoteActions
        quoteId={quote.id}
        quoteNumber={quote.quoteNumber}
        clientName={quote.doc.client.name}
        totalInclVat={fmtMoney(quote.grandTotal)}
        canAct={quote.status === "sent"}
        checkout={checkout}
      />

      <QuoteDocument doc={quote.doc} />
    </div>
  );
}
