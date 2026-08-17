"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { approveAndSendQuote } from "../actions";

/** Three different situations land on the same send() call underneath, but
 *  they are three different actions to the person clicking — say so. */
export type SendQuoteMode = "approve" | "send" | "retry";

const COPY: Record<SendQuoteMode, { title: string; body: string; idle: string; busy: string }> = {
  approve: {
    title: "Pending review",
    body: "Rocky built this quote from a supplier reply — it hasn’t been sent to the client yet.",
    idle: "Approve & send",
    busy: "Sending…",
  },
  send: {
    title: "Not yet sent",
    body: "This quote is a draft and has never been emailed to the client.",
    idle: "Send to client",
    busy: "Sending…",
  },
  retry: {
    title: "Delivery unconfirmed",
    body: "This quote was marked sent, but delivery was never confirmed — pressing this button again retries.",
    idle: "Retry delivery",
    busy: "Retrying…",
  },
};

/** Staff control that sends (or resends) a quote to the client: approving a
 *  pending-review quote, sending a draft for the first time, or retrying a
 *  delivery that never confirmed — see `mode` for which. */
export function ApproveAndSendQuote({ quoteId, mode = "approve" }: { quoteId: string; mode?: SendQuoteMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  const approve = () => {
    setError(null);
    start(async () => {
      const res = await approveAndSendQuote(quoteId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <Card>
      <CardHeader title={copy.title} />
      <div className="space-y-3 px-4 py-3.5">
        <p className="text-xs text-muted">{copy.body}</p>
        {error && (
          <p className="rounded-md bg-brand-tint px-2.5 py-1.5 text-xs font-medium text-[#B01218]">{error}</p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={approve}
          className="w-full rounded-md bg-good px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {pending ? copy.busy : copy.idle}
        </button>
      </div>
    </Card>
  );
}
