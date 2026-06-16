"use client";

import { useActionState } from "react";
import { saveMyName, type NameResult } from "./actions";

export function WelcomeForm() {
  const [state, action, pending] = useActionState<NameResult, FormData>(saveMyName, null);
  const field =
    "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-faint";

  return (
    <form action={action} className="mt-6 space-y-3.5">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">First name</span>
        <input name="first_name" type="text" required autoFocus autoComplete="given-name" className={field} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Last name</span>
        <input name="last_name" type="text" required autoComplete="family-name" className={field} />
      </label>

      {state?.error && (
        <p className="rounded-lg bg-brand-tint px-3 py-2 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B81016] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
