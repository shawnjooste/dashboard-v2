import type { UserRole, ProfileStatus } from "@/lib/types/domain";

export type RouteInput = {
  authenticated: boolean;
  role: UserRole;
  status: ProfileStatus;
  hasClient: boolean;
  hasClaimedDevice: boolean;
};

/** Where a sign-in lands when the link didn't name a destination. Status
 *  first, deliberately: what's broken right now is the thing most people open
 *  the portal to find out. Staff are carried on to /admin/status by
 *  staffRedirectFor below, so this one constant covers both.
 *
 *  Only the DEFAULT. A link that names where to go (a quote email, an invite
 *  carrying next=…) still goes there. */
export const POST_LOGIN_PATH = "/status";

/** Where a staff member lands when they open a client-side route. Almost
 *  nothing in the client portal has a staff equivalent, so they go to the admin
 *  overview — but /status does, and every status email (and the announcement)
 *  links to /status. A staff member clicking their own copy should get the page
 *  it names, not be dumped on the dashboard. */
export function staffRedirectFor(pathname: string): string {
  return pathname === "/status" ? "/admin/status" : "/admin";
}

export function resolveLandingPath(input: RouteInput): string {
  if (!input.authenticated) return "/login";
  if (input.role === "rocking_staff") return "/admin";
  if (input.status === "pending" || !input.hasClient) return "/pending";
  // Members don't self-claim computers — a manager or Rocking assigns them.
  return "/app";
}
