"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleJobPinned } from "../actions";

/** Golden ticket — floats this job to the top of its board column. */
export function JobPinControl({ jobId, pinned }: { jobId: string; pinned: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleJobPinned(jobId, !pinned);
          router.refresh();
        })
      }
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        pinned ? "bg-warn-tint text-warn-ink" : "border border-line text-ink-2 hover:bg-line-soft"
      }`}
      aria-pressed={pinned}
    >
      {pinned ? "★ Pinned" : "☆ Pin to top"}
    </button>
  );
}
