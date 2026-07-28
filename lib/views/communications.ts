import { createClient } from "@/lib/supabase/server";

export type SentEmailRow = {
  id: string;
  subject: string;
  toEmails: string[];
  category: string;
  sentAt: string;
  html: string;
};

/** Emails the signed-in user is allowed to see, newest first. All scoping —
 *  client, audience, and manager-vs-member — is enforced by RLS on
 *  sent_emails, not here. */
export async function getMyCommunications(): Promise<SentEmailRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sent_emails")
    .select("id, subject, to_emails, category, sent_at, html")
    .order("sent_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id,
    subject: e.subject,
    toEmails: e.to_emails ?? [],
    category: e.category,
    sentAt: e.sent_at,
    html: e.html,
  }));
}
