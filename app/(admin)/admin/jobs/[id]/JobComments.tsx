"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobComment, deleteJobComment } from "../actions";
import type { JobComment } from "@/lib/views/jobs";

const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);

/** Internal staff discussion. Never emailed, never shown to a client. */
export function JobComments({ jobId, comments }: { jobId: string; comments: JobComment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const post = () => {
    if (!body.trim()) return;
    const value = body;
    setBody("");
    run(() => addJobComment(jobId, value));
  };

  return (
    <div>
      <div className="divide-y divide-line-soft">
        {comments.map((c) => (
          <div key={c.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold capitalize text-ink">{c.author ?? "—"}</span>
              <span className="ml-auto text-xs text-faint">{fmtTs(c.createdAt)}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteJobComment(c.id, jobId))}
                className="shrink-0 text-faint hover:text-brand disabled:opacity-60"
                aria-label="Delete comment"
              >
                ✕
              </button>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink-2">{c.body}</div>
          </div>
        ))}
        {comments.length === 0 && <div className="px-4 py-3 text-xs text-faint">No comments yet.</div>}
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a comment for the team…"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint">Internal only &mdash; the client never sees this.</span>
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={post}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {pending ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
