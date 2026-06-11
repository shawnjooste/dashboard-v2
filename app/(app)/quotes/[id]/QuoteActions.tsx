"use client";

import { useState, useTransition } from "react";
import { acceptQuote, declineQuote, requestChanges } from "./actions";

/** Accept / Request changes / Decline / Print. First click wins server-side;
 *  errors from a lost race surface in the inline message. */
export function QuoteActions({
  quoteId,
  quoteNumber,
  clientName,
  totalInclVat,
  canAct,
}: {
  quoteId: string;
  quoteNumber: string;
  clientName: string;
  totalInclVat: string;
  canAct: boolean;
}) {
  const [mode, setMode] = useState<"none" | "amend" | "decline">("none");
  const [comment, setComment] = useState("");
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

  const onAccept = () => {
    if (
      !window.confirm(
        `Accept quote ${quoteNumber} for ${totalInclVat} incl VAT on behalf of ${clientName}?`,
      )
    )
      return;
    run(() => acceptQuote(quoteId));
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
              onClick={onAccept}
              disabled={pending}
              className="rounded-lg bg-good px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#116c33] disabled:opacity-50"
            >
              Accept quote
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

      {mode !== "none" && canAct && (
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
