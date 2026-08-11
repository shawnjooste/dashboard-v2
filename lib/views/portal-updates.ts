import { createClient } from "@/lib/supabase/server";

export type Recipient = { email: string; name: string; clientName: string };

/** Who would receive a Portal Update, and who has switched them off.
 *  Staff-only by RLS. For previewing a send — the guarantee that opted-out
 *  people are excluded lives in lib/email/send.ts, not here. */
export async function getPortalUpdateRecipients(
  clientId?: string,
): Promise<{ eligible: Recipient[]; optedOut: Recipient[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("profiles")
    .select("email, client_id, portal_updates_opt_out, people(display_name)")
    .eq("status", "active")
    .in("role", ["client_manager", "client_member"]);
  if (clientId) q = q.eq("client_id", clientId);
  const [{ data, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const eligible: Recipient[] = [];
  const optedOut: Recipient[] = [];
  for (const r of data ?? []) {
    const person = Array.isArray(r.people) ? r.people[0] : r.people;
    const row: Recipient = {
      email: r.email,
      name: (person as { display_name?: string } | null)?.display_name ?? r.email,
      clientName: r.client_id ? (clientName.get(r.client_id) ?? "—") : "—",
    };
    (r.portal_updates_opt_out ? optedOut : eligible).push(row);
  }
  const byName = (a: Recipient, b: Recipient) =>
    a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name);
  return { eligible: eligible.sort(byName), optedOut: optedOut.sort(byName) };
}
