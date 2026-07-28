"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { approveAndSendQuote } from "../actions";

/** Staff control for a quote the automated pipeline built and hasn't sent
 *  yet — review the document + margin on this page, then approve to send. */
export function ApproveAndSendQuote({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      <CardHeader title="Pending review" />
      <div className="space-y-3 px-4 py-3.5">
        <p className="text-xs text-muted">
          Rocky built this quote from a supplier reply — it hasn&rsquo;t been sent to the client yet.
        </p>
        {error && (
          <p className="rounded-md bg-brand-tint px-2.5 py-1.5 text-xs font-medium text-[#B01218]">{error}</p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={approve}
          className="w-full rounded-md bg-good px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Approve & send"}
        </button>
      </div>
    </Card>
  );
}
