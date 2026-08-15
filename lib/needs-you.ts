import type { QuoteListRow } from "@/lib/views/quotes";
import type { AgreementRow } from "@/lib/views/agreements";
import type { TicketSummary } from "@/lib/freescout";

export type NeedsYouItem = {
  kind: "quote" | "agreement" | "payment" | "ticket";
  href: string;
  title: string;
  detail: string;
  /** Renders in the brand tint rather than plain — money and outages only. */
  urgent: boolean;
};

export type NeedsYouInput = {
  quotes: QuoteListRow[];
  agreements: AgreementRow[];
  failedPayments: { id: string; quoteId: string }[];
  tickets: TicketSummary[];
};

/** What's waiting on this person, most consequential first. Pure so the rules
 *  are testable without a database — and because this same list becomes the
 *  push-notification set in the mobile app, where getting the ordering wrong
 *  is a lot more annoying than on a web page. */
export function buildNeedsYou(input: NeedsYouInput): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  // Money first: a failed debit order stops service.
  for (const p of input.failedPayments) {
    items.push({
      kind: "payment",
      href: `/quotes/${p.quoteId}/pay`,
      title: "Payment problem",
      detail: "Your last monthly payment didn't go through.",
      urgent: true,
    });
  }

  for (const q of input.quotes) {
    if (q.status !== "sent") continue;
    items.push({
      kind: "quote",
      href: `/quotes/${q.id}`,
      title: q.title,
      detail: q.validUntil ? `${q.quoteNumber} · valid until ${q.validUntil}` : q.quoteNumber,
      urgent: false,
    });
  }

  for (const a of input.agreements) {
    // signedAt alone doesn't cover it: a voided agreement also has
    // signed_at = null (per 0083_agreements.sql the status set is
    // draft | sent | signed | void), so without the status check a voided
    // agreement would show "signature needed" forever with nowhere for the
    // client to clear it. Mirrors the filter agreements/page.tsx already
    // uses for its own "awaiting signature" banner.
    if (a.signedAt || a.status !== "sent") continue;
    items.push({
      kind: "agreement",
      href: `/agreements/${a.id}`,
      title: a.title,
      detail: `${a.reference} · signature needed`,
      urgent: false,
    });
  }

  for (const t of input.tickets) {
    if (t.status === "closed") continue;
    items.push({
      kind: "ticket",
      href: `/support/${t.id}`,
      title: t.subject,
      detail: `#${t.number}`,
      urgent: false,
    });
  }

  return items;
}
