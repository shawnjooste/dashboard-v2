"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createTicketAction, type SupportActionState } from "../actions";
import { PageHeader, SecondaryLink, Card } from "@/components/ui";

const initial: SupportActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send ticket"}
    </button>
  );
}

export default function NewTicketPage() {
  const [state, action] = useActionState(createTicketAction, initial);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<SecondaryLink href="/support">← Back to support</SecondaryLink>}
        title="Raise a ticket"
        subtitle="Tell us what's wrong in your own words — a real person picks this up."
      />

      <Card>
        <form action={action} className="space-y-4 p-4">
          <div className="space-y-1.5">
            <label htmlFor="subject" className="block text-[13px] font-semibold text-ink-2">
              Subject
            </label>
            <input
              id="subject"
              name="subject"
              required
              maxLength={150}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13.5px] text-ink outline-none"
              placeholder="What do you need help with?"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="message" className="block text-[13px] font-semibold text-ink-2">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={6}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13.5px] text-ink outline-none"
              placeholder="Tell us what happened, and on which machine — the more detail, the faster we can help."
            />
          </div>
          {state.error && <p className="text-[13px] text-brand">{state.error}</p>}
          <SubmitButton />
        </form>
      </Card>
    </div>
  );
}
