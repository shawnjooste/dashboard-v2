import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createServiceClient } from "@/lib/supabase/service";
import { getQuoteDetail } from "@/lib/views/quotes";
import { fmtMoney, STATUS_LABEL } from "@/lib/quotes/doc";
import { notifyQuoteViewed } from "@/lib/quote-emails";
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

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

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

  const decidedBanner =
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
      />

      <QuoteDocument doc={quote.doc} />
    </div>
  );
}
