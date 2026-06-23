"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask, toggleTask, deleteTask, setTaskAssignee, moveTask } from "../actions";
import type { JobTask, AssigneeOption } from "@/lib/views/jobs";

export function JobChecklist({ jobId, tasks, assignees }: { jobId: string; tasks: JobTask[]; assignees: AssigneeOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const staffOptions = assignees.filter((a) => a.kind === "staff");
  const clientOptions = assignees.filter((a) => a.kind === "client");

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
        {tasks.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              checked={t.done}
              disabled={pending}
              onChange={() => run(() => toggleTask(t.id, jobId, !t.done))}
              className="h-4 w-4 shrink-0 accent-[#D7141C]"
            />
            <span className={`flex-1 text-[13.5px] ${t.done ? "text-faint line-through" : "text-ink"}`}>{t.label}</span>
            <select
              value={t.assigneeProfileId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => setTaskAssignee(t.id, jobId, e.target.value || null))}
              className="shrink-0 max-w-[140px] rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] text-ink-2 outline-none focus:border-faint disabled:opacity-60"
              aria-label="Assignee"
            >
              <option value="">Unassigned</option>
              {staffOptions.length > 0 && (
                <optgroup label="Rocking">
                  {staffOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {clientOptions.length > 0 && (
                <optgroup label="Client">
                  {clientOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="flex shrink-0 items-center text-faint">
              <button
                type="button"
                disabled={pending || i === 0}
                onClick={() => run(() => moveTask(t.id, jobId, "up"))}
                className="px-0.5 leading-none hover:text-ink disabled:opacity-30 disabled:hover:text-faint"
                aria-label="Move task up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={pending || i === tasks.length - 1}
                onClick={() => run(() => moveTask(t.id, jobId, "down"))}
                className="px-0.5 leading-none hover:text-ink disabled:opacity-30 disabled:hover:text-faint"
                aria-label="Move task down"
              >
                ↓
              </button>
            </div>
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
