"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createTicketAction, type SupportActionState } from "../actions";

const initial: SupportActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Sending…" : "Open ticket"}
    </button>
  );
}

export default function NewTicketPage() {
  const [state, action] = useActionState(createTicketAction, initial);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/support" className="text-sm text-blue-600 hover:underline">
        ← Support
      </Link>
      <h1 className="text-xl font-semibold">New support ticket</h1>
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="subject" className="block text-sm font-medium">
            Subject
          </label>
          <input
            id="subject"
            name="subject"
            required
            maxLength={150}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            placeholder="What do you need help with?"
          />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={6}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            placeholder="Describe the problem — what happened, and on which machine?"
          />
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton />
      </form>
    </div>
  );
}
