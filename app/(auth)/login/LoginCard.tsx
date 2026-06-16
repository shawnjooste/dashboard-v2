"use client";

import Image from "next/image";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import logo from "@/public/rocking-logo.png";
import { requestCode, verifyCode, type ActionState } from "./actions";

const initial: ActionState = {};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function LoginCard({ linkError }: { linkError?: boolean }) {
  const [reqState, reqAction] = useActionState(requestCode, initial);
  const [verState, verAction] = useActionState(verifyCode, initial);
  const sent = reqState.codeSent;
  const email = reqState.email ?? "";

  const fieldCls =
    "w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-faint";

  return (
    <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-line bg-card shadow-[0_18px_48px_rgba(24,24,27,0.08)]">
      <div className="h-1 bg-brand" />
      <div className="px-8 pb-7 pt-8">
        <div className="mb-7 flex flex-col items-center">
          <Image src={logo} alt="Rocking" width={150} height={29} priority className="h-[29px] w-auto" />
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-[2px] text-faint">The Portal</span>
        </div>

        <h1 className="text-center text-xl font-bold text-ink">Sign in</h1>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-center text-[13.5px] leading-relaxed text-muted">
          {!sent
            ? "Enter your email and we'll send you a 6-digit sign-in code."
            : "Enter the 6-digit code we just emailed you."}
        </p>

        {linkError && !sent && (
          <p className="mt-5 rounded-lg bg-brand-tint px-3 py-2 text-[13px] font-medium text-[#B01218]">
            That sign-in link has expired or was already used — enter your email for a fresh code.
          </p>
        )}

        {!sent ? (
          <form action={reqAction} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-[13px] font-semibold text-ink-2">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                className={fieldCls}
                placeholder="you@company.co.za"
              />
            </div>
            {reqState.error && <p className="text-[13px] font-medium text-brand">{reqState.error}</p>}
            <SubmitButton>Email me a code</SubmitButton>
          </form>
        ) : (
          <form action={verAction} className="mt-6 space-y-4">
            <p className="text-[13.5px] text-muted">
              We sent a 6-digit code to{" "}
              <strong className="font-semibold text-ink-2">{email}</strong>.
            </p>
            <input type="hidden" name="email" value={email} />
            <div className="space-y-1.5">
              <label htmlFor="token" className="block text-[13px] font-semibold text-ink-2">
                6-digit code
              </label>
              <input
                id="token"
                name="token"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
                className={`${fieldCls} text-center text-lg tracking-[0.5em]`}
                placeholder="123456"
              />
            </div>
            {verState.error && <p className="text-[13px] font-medium text-brand">{verState.error}</p>}
            <SubmitButton>Verify &amp; sign in</SubmitButton>
            <a href="/login" className="block text-center text-[13px] text-muted transition-colors hover:text-ink-2">
              Use a different email
            </a>
          </form>
        )}
      </div>

      <div className="border-t border-line-soft px-8 py-3.5 text-center text-[12px] text-faint">
        Passwordless · no password to remember
      </div>
    </div>
  );
}
