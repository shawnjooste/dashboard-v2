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
      className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">Sign in to Rocking</h1>

        {!sent ? (
          <form action={reqAction} className="space-y-4">
            <label htmlFor="email" className="block text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded border px-3 py-2"
              placeholder="you@company.com"
            />
            {reqState.error && (
              <p className="text-sm text-red-600">{reqState.error}</p>
            )}
            <SubmitButton>Email me a code</SubmitButton>
          </form>
        ) : (
          <form action={verAction} className="space-y-4">
            <p className="text-sm text-gray-600">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <input type="hidden" name="email" value={email} />
            <label htmlFor="token" className="block text-sm font-medium">
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
              className="w-full rounded border px-3 py-2 tracking-widest"
              placeholder="123456"
            />
            {verState.error && (
              <p className="text-sm text-red-600">{verState.error}</p>
            )}
            <SubmitButton>Verify &amp; sign in</SubmitButton>
            <a
              href="/login"
              className="block text-center text-sm text-gray-500 underline"
            >
              Use a different email
            </a>
          </form>
        )}
      </div>
    </main>
  );
}
