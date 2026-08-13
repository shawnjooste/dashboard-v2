// The one door every portal email goes through: sends via Resend, then
// records the message in sent_emails so /communications and the admin
// activity feed have a complete history. If you add a new email anywhere,
// call THIS — a send that bypasses it is invisible to the client's history.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { deliverEmail, type DeliverOptions } from "./deliver.ts";

export const DEFAULT_FROM = '"Rocking" <no-reply@send.rocking.one>';
export type SendEmailOptions = DeliverOptions;

/** Sends the email and records it. Returns Resend's raw message id (callers
 *  that need a threading header format it themselves), or null when the send
 *  was skipped for want of an API key. Throws only if Resend rejects the send;
 *  a logging failure never propagates. */
export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ id: string | null; suppressed: string[] }> {
  return deliverEmail(createServiceClient(), opts);
}
