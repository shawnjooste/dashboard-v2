/** Who a Portal Update would actually reach — pure, no server imports
 *  (vitest-safe). The data loading lives in ./portal-updates.ts.
 *
 *  Three buckets, and the order of the checks is the point:
 *  `excluded` (can't see the section / doesn't have the service) is decided
 *  BEFORE `optedOut`, because someone who cannot open the page was never in
 *  the audience — filing them under "opted out" would overstate refusals. */
import { canAccess, toOverrides } from "../feature-access";

export type Recipient = { email: string; name: string; clientName: string };
export type ExcludedRecipient = Recipient & { reason: "no_feature" | "no_service" };

export type PartitionRow = {
  email: string;
  name: string;
  clientName: string;
  clientId: string | null;
  role: string;
  /** Raw profiles.feature_overrides jsonb — narrowed here. */
  overrides: unknown;
  optedOut: boolean;
};

const byClientThenName = (a: Recipient, b: Recipient) =>
  a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name);

export function partitionRecipients(
  rows: PartitionRow[],
  opts: { feature?: string; clientIdsWithService?: Set<string> } = {},
): { eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] } {
  const eligible: Recipient[] = [];
  const optedOut: Recipient[] = [];
  const excluded: ExcludedRecipient[] = [];

  for (const r of rows) {
    const person: Recipient = { email: r.email, name: r.name, clientName: r.clientName };
    if (opts.feature && !canAccess(r.role, toOverrides(r.overrides), opts.feature)) {
      excluded.push({ ...person, reason: "no_feature" });
      continue;
    }
    if (opts.clientIdsWithService && !(r.clientId && opts.clientIdsWithService.has(r.clientId))) {
      excluded.push({ ...person, reason: "no_service" });
      continue;
    }
    (r.optedOut ? optedOut : eligible).push(person);
  }

  return {
    eligible: eligible.sort(byClientThenName),
    optedOut: optedOut.sort(byClientThenName),
    excluded: excluded.sort(byClientThenName),
  };
}
