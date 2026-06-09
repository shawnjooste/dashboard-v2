"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type ActionState } from "./actions";

const initial: ActionState = {};

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
            <label className="block text-sm font-medium">Email address</label>
            <input
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
            <button className="w-full rounded bg-black px-3 py-2 text-white">
              Email me a code
            </button>
          </form>
        ) : (
          <form action={verAction} className="space-y-4">
            <p className="text-sm text-gray-600">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <input type="hidden" name="email" value={email} />
            <label className="block text-sm font-medium">6-digit code</label>
            <input
              name="token"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              className="w-full rounded border px-3 py-2 tracking-widest"
              placeholder="123456"
            />
            {verState.error && (
              <p className="text-sm text-red-600">{verState.error}</p>
            )}
            <button className="w-full rounded bg-black px-3 py-2 text-white">
              Verify &amp; sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
