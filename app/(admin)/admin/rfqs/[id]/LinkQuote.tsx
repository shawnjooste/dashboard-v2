"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkQuote } from "../actions";
import type { QuoteOption } from "@/lib/views/rfqs";

export function LinkQuote({
  rfqId,
  clientId,
  quoteId,
  quoteNumber,
  linkableQuotes,
}: {
  rfqId: string;
  clientId: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  linkableQuotes: QuoteOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");

  if (quoteId) {
    return (
      <div className="px-4 py-3.5 text-[13px]">
        <span className="text-muted">Linked quote: </span>
        <Link href={`/admin/quotes/${quoteId}`} className="font-semibold text-brand hover:text-brand-dark">
          {quoteNumber ?? "view"}
        </Link>
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="px-4 py-3.5 text-[13px] text-faint">
        Set a client on this RFQ to link one of their quotes.
      </div>
    );
  }

  if (linkableQuotes.length === 0) {
    return (
      <div className="px-4 py-3.5 text-[13px] text-faint">
        No quotes for this client yet — create one, then link it here.
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-4 py-3.5">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
      >
        <option value="">Choose a quote…</option>
        {linkableQuotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !pick}
        onClick={() =>
          start(async () => {
            await linkQuote(rfqId, pick);
            router.refresh();
          })
        }
        className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60"
      >
        {pending ? "Linking…" : "Link"}
      </button>
    </div>
  );
}
