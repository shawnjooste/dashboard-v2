import type { ProfileStatus } from "@/lib/types/domain";

/** How much of the portal a signed-in client user may reach.
 *  - full     — approved and linked to a company; the normal portal
 *  - pending  — waiting to be assigned; the holding page plus the status page
 *  - rejected — access declined; the holding page only */
export type PendingMode = "full" | "pending" | "rejected";

export type PendingAccess = {
  mode: PendingMode;
  /** Where to send them, or null to let the request through. */
  redirectTo: string | null;
};

const HOLDING = "/pending";

/** Paths an unassigned user may still reach. Exact matches — neither route has
 *  children, and prefix matching would open up anything nested later. */
const PENDING_ALLOWED = new Set([HOLDING, "/status"]);

/** Gate for the (app) route group. Anyone without a company is held on the
 *  holding page, but may read the status page — an outage is often exactly why
 *  they signed in. A rejected user keeps no portal surface at all.
 *
 *  `!hasClient` is checked independently of status on purpose: an 'active'
 *  profile that somehow has no company must still be held, not waved through. */
export function resolvePendingAccess(input: {
  status: ProfileStatus;
  hasClient: boolean;
  pathname: string;
}): PendingAccess {
  if (input.status === "rejected") {
    return { mode: "rejected", redirectTo: input.pathname === HOLDING ? null : HOLDING };
  }
  if (input.status === "pending" || !input.hasClient) {
    return {
      mode: "pending",
      redirectTo: PENDING_ALLOWED.has(input.pathname) ? null : HOLDING,
    };
  }
  return { mode: "full", redirectTo: null };
}
