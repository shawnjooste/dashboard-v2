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
      className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
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
        className="w-full rounded border border-gray-300 px-3 py-2"
        placeholder={closed ? "This ticket is closed — replying will reopen it." : "Write your reply…"}
      />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton closed={closed} />
    </form>
  );
}
