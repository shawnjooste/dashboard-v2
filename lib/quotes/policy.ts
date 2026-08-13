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

/** A quote can read 'sent' while the email never went: the send event's
 *  resend_message_id is written only once Resend confirms. */
export function canRetryDelivery(status: QuoteStatus, sentEventMessageId: string | null): boolean {
  return status === "sent" && sentEventMessageId === null;
}
