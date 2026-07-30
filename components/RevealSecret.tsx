"use client";

import { useState, useTransition } from "react";
import { revealPppoeSecret } from "@/lib/actions/connectivity";

/** Masked password with an explicit reveal — the value only ever crosses the
 *  wire when someone asks for it. */
export function RevealSecret({ serviceId }: { serviceId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (secret)
    return <code className="rounded bg-line-soft px-1.5 py-0.5 text-[12.5px] text-ink">{secret}</code>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="rounded bg-line-soft px-1.5 py-0.5 text-[12.5px] text-faint">••••••••</code>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await revealPppoeSecret(serviceId);
            if (res.ok) setSecret(res.secret);
            else setErr(res.error);
          })
        }
        className="text-[12.5px] font-semibold text-ink-3 hover:text-ink disabled:opacity-60"
      >
        {pending ? "…" : "Reveal"}
      </button>
      {err && <span className="text-[12px] text-brand">{err}</span>}
    </span>
  );
}
