"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask, toggleTask, deleteTask } from "../actions";
import type { JobTask } from "@/lib/views/jobs";

export function JobChecklist({ jobId, tasks }: { jobId: string; tasks: JobTask[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  const add = () => {
    if (!label.trim()) return;
    const value = label;
    setLabel("");
    run(() => addTask(jobId, value));
  };

  return (
    <div>
      <div className="divide-y divide-line-soft">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={t.done}
              disabled={pending}
              onChange={() => run(() => toggleTask(t.id, jobId, !t.done))}
              className="h-4 w-4 shrink-0 accent-[#D7141C]"
            />
            <span className={`flex-1 text-[13.5px] ${t.done ? "text-faint line-through" : "text-ink"}`}>{t.label}</span>
            {t.assigneeLabel && <span className="shrink-0 text-[11px] capitalize text-faint">{t.assigneeLabel}</span>}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteTask(t.id, jobId))}
              className="shrink-0 text-faint hover:text-brand disabled:opacity-60"
              aria-label="Delete task"
            >
              ✕
            </button>
          </div>
        ))}
        {tasks.length === 0 && <div className="px-4 py-3 text-xs text-faint">No tasks yet.</div>}
      </div>

      <div className="flex gap-2 border-t border-line-soft px-4 py-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a task…"
          className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
        />
        <button
          type="button"
          disabled={pending}
          onClick={add}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft disabled:opacity-60"
        >
          Add
        </button>
      </div>
    </div>
  );
}
