"use client";

import { useState, useTransition } from "react";
import { setStatusSubscription } from "@/lib/actions/status";

/** Opt in/out of status emails. Updates locally on success so the preference
 *  never costs the reader their place on the page. */
export function SubscribeToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !on;
    setErr(null);
    start(async () => {
      try {
        await setStatusSubscription(next);
        setOn(next);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
          on ? "bg-ink text-white hover:bg-black" : "border border-line text-ink-2 hover:bg-line-soft"
        }`}
      >
        {pending ? "Saving…" : on ? "Emailing you updates ✓" : "Email me updates"}
      </button>
      <span className="text-[12.5px] text-muted">
        {on
          ? "You'll get an email for every new incident and update."
          : "Get an email whenever something changes."}
      </span>
      {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
    </div>
  );
}
