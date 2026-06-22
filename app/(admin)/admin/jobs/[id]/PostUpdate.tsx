"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postJobUpdate } from "../actions";

export function PostUpdate({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  const send = () => {
    if (!body.trim()) return;
    const value = body;
    setBody("");
    start(async () => {
      await postJobUpdate(jobId, value);
      router.refresh();
    });
  };

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Post an update to the client…"
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-faint">Emails the client&rsquo;s managers.</span>
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={send}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          {pending ? "Sending…" : "Post update"}
        </button>
      </div>
    </div>
  );
}
