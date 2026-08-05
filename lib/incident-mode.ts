/** Pure incident-mode logic — no server imports (vitest-safe).
 *
 *  "Incident mode" is not a switch of its own: it is the `opens_chat` flag on
 *  an active incident. While such an incident is running, everyone who can see
 *  it gets live chat whatever their support package says. Resolving the
 *  incident closes chat again, which is the whole design — there is nothing to
 *  remember to turn off.
 *
 *  Both functions take only the incidents the caller is allowed to see; RLS
 *  has already done the scoping, so a client-scoped incident reaches exactly
 *  the clients it targets. */

import { typeRank } from "./status-helpers";

export type ActiveIncident = {
  id: string;
  title: string;
  type: string;
  opensChat: boolean;
};

/** Does any incident this viewer can see open chat to them? */
export function chatOpenedByIncident(active: ActiveIncident[]): boolean {
  return active.some((i) => i.opensChat);
}

/** The incident to put a banner across the portal for, or null for quiet.
 *
 *  Outages only — degraded service and scheduled maintenance stay on the
 *  status page behind the dot, so the banner keeps meaning something. The one
 *  addition is any incident that opened chat: a chat widget appearing out of
 *  nowhere with no explanation is worse than a banner, so it always gets one.
 *
 *  Ties break on the caller's order (the view sorts newest first). */
export function bannerIncident(active: ActiveIncident[]): ActiveIncident | null {
  const shown = active.filter((i) => i.type === "outage" || i.opensChat);
  if (shown.length === 0) return null;
  // Stable sort: worst type wins, and within a type the newest one does.
  return [...shown].sort((a, b) => typeRank(a.type) - typeRank(b.type))[0];
}
