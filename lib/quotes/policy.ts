/** Quote policy: the rules, with no I/O so they can be tested exhaustively.
 *  Only sendQuote may set status 'sent' — a quote marked sent that nobody
 *  received would be the status field telling a lie. */

export type Actor = { id: string | null; label: string; canSend: boolean };

export type QuoteStatus =
  | "draft" | "pending_review" | "sent"
  | "accepted" | "rejected" | "changes_requested" | "expired";

export function decideCreateStatus(actor: Actor): "draft" | "pending_review" {
  return actor.canSend ? "draft" : "pending_review";
}

/** Amending always pulls a live quote out of 'sent', for every actor, so a
 *  revision is never visible to the client before someone sends it. */
export function decideAmendStatus(actor: Actor): "draft" | "pending_review" {
  return actor.canSend ? "draft" : "pending_review";
}

export function canSendFrom(status: QuoteStatus): boolean {
  return status === "draft" || status === "pending_review";
}

/** How long a send() delivery claim (see service.ts) is honoured before it's
 *  treated as abandoned. Comfortably beyond any realistic deliverEmail round
 *  trip, while still recovering a crashed send the same day: a process that
 *  claims a quote and then dies (a Vercel maxDuration timeout, a killed CLI,
 *  a dropped SSH session) before finalizing or releasing must not strand the
 *  quote forever — that is worse than the double-send the claim exists to
 *  prevent, because nothing ever alerts on a crash. */
export const CLAIM_LEASE_MS = 15 * 60 * 1000;

/** Parses a send() claim token ("claiming:<epoch-ms>:<uuid>") into its
 *  embedded timestamp. Returns null for anything else — a real Resend id
 *  (e.g. "<abc@send.rocking.one>") is never mistaken for a claim. */
function claimedAtMs(messageId: string): number | null {
  const m = /^claiming:(\d+):/.exec(messageId);
  return m ? Number(m[1]) : null;
}

/** A quote can read 'sent' while the email never went, in three shapes:
 *  - resend_message_id is null: delivery was never attempted, or a prior
 *    attempt explicitly released its claim (a failed send, no active
 *    managers, or a finalize-write failure) — immediately retryable.
 *  - resend_message_id is a claim token younger than CLAIM_LEASE_MS: some
 *    other send() call is genuinely in flight right now — not retryable.
 *  - resend_message_id is a claim token older than CLAIM_LEASE_MS: whoever
 *    held it never finished — retryable as an abandoned claim.
 *  Anything else is a confirmed Resend id: never retryable. `now` is
 *  injected (defaulting to the real clock) so the staleness boundary is
 *  exhaustively testable without faking global time. */
export function canRetryDelivery(
  status: QuoteStatus,
  sentEventMessageId: string | null,
  now: Date = new Date(),
): boolean {
  if (status !== "sent") return false;
  if (sentEventMessageId === null) return true;
  const claimedAt = claimedAtMs(sentEventMessageId);
  if (claimedAt === null) return false; // a confirmed id, not a claim
  return now.getTime() - claimedAt >= CLAIM_LEASE_MS;
}
