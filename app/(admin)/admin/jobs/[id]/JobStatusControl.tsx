"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStatus } from "../actions";
import type { JobStatus } from "@/lib/views/jobs";

const STAGES: [JobStatus, string][] = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting"],
  ["done", "Done"],
];

export function JobStatusControl({
  jobId,
  status,
  waitingNote,
}: {
  jobId: string;
  status: JobStatus;
  waitingNote: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [wait, setWait] = useState(waitingNote ?? "");

  const move = (s: JobStatus) =>
    start(async () => {
      await setJobStatus(jobId, s, s === "waiting" ? wait : null);
      router.refresh();
    });

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {STAGES.map(([s, label]) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => move(s)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
              status === s ? "bg-ink text-white" : "border border-line text-ink-2 hover:bg-line-soft"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => move("cancelled")}
          className={`ml-auto text-[12px] ${status === "cancelled" ? "font-semibold text-brand" : "text-faint hover:text-brand"} disabled:opacity-60`}
        >
          {status === "cancelled" ? "Cancelled" : "Cancel job"}
        </button>
      </div>

      {status === "waiting" && (
        <div className="mt-3 flex gap-2">
          <input
            value={wait}
            onChange={(e) => setWait(e.target.value)}
            placeholder="What's it waiting on? (e.g. parts on order)"
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => move("waiting")}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
