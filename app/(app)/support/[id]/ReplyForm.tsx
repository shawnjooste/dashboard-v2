"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { replyAction, type SupportActionState } from "../actions";

const initial: SupportActionState = {};

function SubmitButton({ closed }: { closed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="min-h-[44px] w-full rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50 md:w-auto"
    >
      {pending ? "Sending…" : closed ? "Reply & reopen" : "Send reply"}
    </button>
  );
}

export function ReplyForm({ ticketId, closed }: { ticketId: number; closed: boolean }) {
  const [state, action] = useActionState(replyAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <label htmlFor="message" className="block text-sm font-medium">
        Reply
      </label>
      <textarea
        id="message"
        name="message"
        required
        rows={4}
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-base text-ink outline-none md:text-[13.5px]"
        placeholder={closed ? "This ticket is closed — replying will reopen it." : "Write your reply…"}
      />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton closed={closed} />
    </form>
  );
}
