"use client";

import { useState, useTransition } from "react";
import { acceptQuote, checkoutQuote, declineQuote, requestChanges } from "./actions";

/** Accept / Request changes / Decline / Print. First click wins server-side;
 *  errors from a lost race surface in the inline message. */
export type CheckoutBreakdown = {
  onceOff: string;
  proRata: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Null on once-off-only quotes — nothing recurs after payment. */
  monthlyIncl: string | null;
  totalIncl: string;
};

export function QuoteActions({
  quoteId,
  quoteNumber,
  clientName,
  totalInclVat,
  canAct,
  checkout = null,
}: {
  quoteId: string;
  quoteNumber: string;
  clientName: string;
  totalInclVat: string;
  canAct: boolean;
  /** Present on checkout-enabled quotes: replaces Accept with paid Checkout. */
  checkout?: CheckoutBreakdown | null;
}) {
  const [mode, setMode] = useState<"none" | "accept" | "checkout" | "amend" | "decline">("none");
  const [comment, setComment] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "something went wrong");
      }
    });
  };

  const submitAccept = () => {
    const fd = new FormData();
    fd.set("po_number", poNumber);
    run(() => acceptQuote(quoteId, fd));
  };

  const submitCheckout = () => {
    setError(null);
    startTransition(async () => {
      const res = await checkoutQuote(quoteId);
      if (res.ok) window.location.href = res.url;
      else setError(res.error);
    });
  };

  const submitComment = () => {
    const fd = new FormData();
    fd.set("comment", comment);
    if (mode === "amend") run(() => requestChanges(quoteId, fd));
    else run(() => declineQuote(quoteId, fd));
  };

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {canAct && (
          <>
            <button
              type="button"
              onClick={() => {
                const target = checkout ? "checkout" : "accept";
                setMode(mode === target ? "none" : target);
                setError(null);
              }}
              disabled={pending}
              className="rounded-lg bg-good px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#116c33] disabled:opacity-50"
            >
              {checkout ? "Checkout" : "Accept quote"}
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === "amend" ? "none" : "amend"); setError(null); }}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft disabled:opacity-50"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === "decline" ? "none" : "decline"); setError(null); }}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-tint disabled:opacity-50"
            >
              Decline
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Print / Save PDF
        </button>
      </div>

      {mode === "checkout" && canAct && checkout && (
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-[13px] font-semibold text-ink">Pay quote {quoteNumber}</p>
          <dl className="mt-3 space-y-1.5 text-[13.5px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">
                {checkout.monthlyIncl ? "Once-off (installation & setup)" : "Quote total (ex VAT)"}
              </dt>
              <dd className="font-medium text-ink-2">{checkout.onceOff}</dd>
            </div>
            {checkout.monthlyIncl && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">
                  {checkout.periodStart
                    ? `Pro-rata for ${checkout.periodStart} to ${checkout.periodEnd}`
                    : "Pro-rata for this month"}
                </dt>
                <dd className="font-medium text-ink-2">
                  {checkout.periodStart ? checkout.proRata : "R 0,00 — billing starts on the 1st"}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-line-soft pt-1.5">
              <dt className="font-semibold text-ink">Payable now (incl VAT)</dt>
              <dd className="font-semibold text-ink">{checkout.totalIncl}</dd>
            </div>
          </dl>
          {checkout.monthlyIncl ? (
            <p className="mt-3 rounded-md bg-line-soft px-3 py-2 text-[12.5px] font-medium text-ink-2">
              {checkout.monthlyIncl} incl VAT will be billed automatically to this card on the 1st of
              every month until cancelled.
            </p>
          ) : (
            <p className="mt-3 rounded-md bg-line-soft px-3 py-2 text-[12.5px] font-medium text-ink-2">
              Once-off payment — nothing further will be billed to this card.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={submitCheckout}
              disabled={pending}
              className="rounded-lg bg-good px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#116c33] disabled:opacity-50"
            >
              {pending ? "Starting payment…" : "Pay now"}
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "accept" && canAct && (
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-[13px] font-medium text-ink">
            Accept quote {quoteNumber} for {totalInclVat} incl VAT on behalf of {clientName}?
          </p>
          <label className="mt-3 block text-[13px] font-semibold text-ink-2">
            Purchase order number (optional)
          </label>
          <input
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="e.g. PO-4521"
            className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13.5px] text-ink outline-none"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={submitAccept}
              disabled={pending}
              className="rounded-lg bg-good px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#116c33] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Confirm accept"}
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(mode === "amend" || mode === "decline") && canAct && (
        <div className="rounded-lg border border-line bg-card p-4">
          <label className="text-[13px] font-semibold text-ink-2">
            {mode === "amend"
              ? "What would you like changed?"
              : "Anything we should know? (optional)"}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              mode === "amend"
                ? "e.g. Can we drop to 3 handsets and quote a cheaper switch?"
                : "e.g. We've decided to hold off this quarter."
            }
            className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13.5px] text-ink outline-none"
            rows={3}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submitComment}
              disabled={pending || (mode === "amend" && !comment.trim())}
              className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {mode === "amend" ? "Send change request" : "Decline quote"}
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[13px] font-medium text-brand">{error}</p>
      )}
    </div>
  );
}
