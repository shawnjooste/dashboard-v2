import { createClient } from "@/lib/supabase/server";
import {
  partitionRecipients,
  type ExcludedRecipient,
  type PartitionRow,
  type Recipient,
} from "./recipient-partition";

export type { Recipient, ExcludedRecipient };

/** Who would receive a Portal Update, who has switched them off, and who was
 *  filtered out (and why). Staff-only by RLS. For previewing a send — the
 *  guarantee that opted-out people are excluded lives in lib/email/send.ts.
 *
 *  `feature` filters on real visibility (role defaults minus that user's
 *  overrides), so nobody is ever mailed about a page they cannot open.
 *  `hasService` filters on data — clients with an active service row. */
export async function getPortalUpdateRecipients(
  opts: { clientId?: string; feature?: string; hasService?: "connectivity" } = {},
): Promise<{ eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("profiles")
    .select("email, client_id, role, feature_overrides, portal_updates_opt_out, people(display_name)")
    .eq("status", "active")
    .in("role", ["client_manager", "client_member"]);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);

  const [{ data, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);

  let clientIdsWithService: Set<string> | undefined;
  if (opts.hasService === "connectivity") {
    const { data: svc, error: svcErr } = await supabase
      .from("connectivity_services")
      .select("client_id")
      .eq("is_active", true);
    if (svcErr) throw new Error(svcErr.message);
    clientIdsWithService = new Set((svc ?? []).map((s) => s.client_id));
  }

  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const rows: PartitionRow[] = (data ?? []).map((r) => {
    const person = Array.isArray(r.people) ? r.people[0] : r.people;
    return {
      email: r.email,
      name: (person as { display_name?: string } | null)?.display_name ?? r.email,
      clientName: r.client_id ? (clientName.get(r.client_id) ?? "—") : "—",
      clientId: r.client_id,
      role: r.role,
      overrides: r.feature_overrides,
      optedOut: Boolean(r.portal_updates_opt_out),
    };
  });

  return partitionRecipients(rows, { feature: opts.feature, clientIdsWithService });
}
