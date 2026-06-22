"use client";

import { useTransition } from "react";
import { createJobFromQuote } from "../../jobs/actions";

/** On an accepted quote — spin up a job pre-filled from it (redirects to the job). */
export function CreateJobFromQuote({ quoteId }: { quoteId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => createJobFromQuote(quoteId))}
      className="w-full rounded-lg bg-ink px-3.5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create job from quote"}
    </button>
  );
}
