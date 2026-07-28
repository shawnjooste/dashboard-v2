"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobDueDate } from "../actions";

/** Target date for the whole job. Drives the board's overdue / due-soon badges. */
export function JobDueDate({ jobId, dueDate }: { jobId: string; dueDate: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Due</span>
      <input
        type="date"
        defaultValue={dueDate ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setJobDueDate(jobId, e.target.value || null);
            router.refresh();
          })
        }
        className="ml-auto rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint disabled:opacity-60"
        aria-label="Job due date"
      />
    </div>
  );
}
