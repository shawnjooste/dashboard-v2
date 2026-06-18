"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { adminDecideQuote } from "../actions";

/** Staff control to accept/reject a quote on the client's behalf. Renders only
 *  for a decidable quote; a two-step confirm guards the irreversible flip. */
export function AdminQuoteDecision({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<null | "accept" | "reject">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (decision: "accepted" | "rejected", comment: string | null) => {
    setError(null);
    start(async () => {
      const res = await adminDecideQuote(quoteId, decision, comment);
      if (res.ok) {
        setMode(null);
        setReason("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader title="Decision (on behalf)" />
      <div className="space-y-3 px-4 py-3.5">
        <p className="text-xs text-muted">
          Record the client&rsquo;s decision yourself — e.g. they confirmed by phone or email.
        </p>

        {error && (
          <p className="rounded-md bg-brand-tint px-2.5 py-1.5 text-xs font-medium text-[#B01218]">{error}</p>
        )}

        {mode === null && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("accept")}
              className="flex-1 rounded-md bg-good px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:brightness-95"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => setMode("reject")}
              className="flex-1 rounded-md border border-line px-3 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:border-faint"
            >
              Reject
            </button>
          </div>
        )}

        {mode === "accept" && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">Accept this quote on behalf of the client?</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run("accepted", null)}
                className="flex-1 rounded-md bg-good px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Confirm accept"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode(null)}
                className="rounded-md border border-line px-3 py-2 text-[13px] font-semibold text-muted hover:bg-line-soft disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "reject" && (
          <div className="space-y-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Reason (optional)"
              className="w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none focus:border-faint"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run("rejected", reason || null)}
                className="flex-1 rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
              >
                {pending ? "Saving…" : "Confirm reject"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode(null)}
                className="rounded-md border border-line px-3 py-2 text-[13px] font-semibold text-muted hover:bg-line-soft disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
