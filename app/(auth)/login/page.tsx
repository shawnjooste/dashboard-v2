"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestCode, verifyCode, type ActionState } from "./actions";

const initial: ActionState = {};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export default function LoginPage() {
  const [reqState, reqAction] = useActionState(requestCode, initial);
  const [verState, verAction] = useActionState(verifyCode, initial);
  const sent = reqState.codeSent;
  const email = reqState.email ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[400px] rounded-lg border border-line bg-card p-8">
        <div className="mb-6 space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold text-ink">Sign in to Rocking</h1>
          <p className="text-[14px] text-muted">
            {!sent
              ? "Enter your email and we'll send you a sign-in code."
              : "Enter the 6-digit code we just emailed you."}
          </p>
        </div>

        {!sent ? (
          <form action={reqAction} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-[13px] font-semibold text-ink-2"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[14px] text-ink outline-none"
                placeholder="you@company.com"
              />
            </div>
            {reqState.error && (
              <p className="text-[13px] text-brand">{reqState.error}</p>
            )}
            <SubmitButton>Email me a code</SubmitButton>
          </form>
        ) : (
          <form action={verAction} className="space-y-4">
            <p className="text-[14px] text-muted">
              We sent a 6-digit code to{" "}
              <strong className="font-semibold text-ink-2">{email}</strong>.
            </p>
            <input type="hidden" name="email" value={email} />
            <div className="space-y-1.5">
              <label
                htmlFor="token"
                className="block text-[13px] font-semibold text-ink-2"
              >
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
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[14px] tracking-widest text-ink outline-none"
                placeholder="123456"
              />
            </div>
            {verState.error && (
              <p className="text-[13px] text-brand">{verState.error}</p>
            )}
            <SubmitButton>Verify &amp; sign in</SubmitButton>
            <a
              href="/login"
              className="block text-center text-[13px] text-muted hover:text-ink-2"
            >
              Use a different email
            </a>
          </form>
        )}
      </div>
    </main>
  );
}
