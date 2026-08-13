"use client";

import { useActionState, useState } from "react";
import { signAgreement, type SignResult } from "@/lib/actions/agreements";

/** Typed name + explicit intent. This is an ordinary electronic signature —
 *  the copy deliberately never claims it is advanced or accredited. */
export function SignBlock({ agreementId }: { agreementId: string }) {
  const [name, setName] = useState("");
  const [intent, setIntent] = useState(false);
  const [state, formAction, pending] = useActionState<SignResult | null, FormData>(
    signAgreement.bind(null, agreementId),
    null,
  );

  const ready = name.trim().length > 1 && intent;

  return (
    <form action={formAction} className="space-y-4">
      <label className="block max-w-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Your full name</span>
        <input
          name="signer_name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jane Mokoena"
          className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-base text-ink outline-none focus:border-faint md:text-sm"
        />
      </label>

      <label className="flex max-w-xl items-start gap-2.5 py-3 md:py-0">
        <input
          type="checkbox"
          name="intent"
          checked={intent}
          onChange={(e) => setIntent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <span className="text-sm text-ink-2">
          I agree to these terms and intend this as my electronic signature.
        </span>
      </label>

      {state && !state.ok && (
        <p className="text-sm font-medium text-brand">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={!ready || pending}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:w-auto"
      >
        {pending ? "Signing…" : "Sign agreement"}
      </button>

      <p className="text-xs text-muted">
        Your name, email address, the time and your IP address are recorded with this signature. Once signed,
        the agreement is locked and neither you nor Rocking One can change it.
      </p>
    </form>
  );
}
