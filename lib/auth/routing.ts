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

/** Turns an untrusted ?next= into a redirect target. Accepts relative,
 *  single-slash paths only; anything else falls back to the default landing
 *  page.
 *
 *  This guards an open redirect on a URL that travels in emails, so it fails
 *  closed — an unrecognised shape is rejected, never sanitised and used. The
 *  protocol-relative case is the one that bites: Next's redirect() treats
 *  "//evil.com" as off-site, so it must never reach it. */
export function safeNext(param: string | null | undefined): string {
  if (!param) return POST_LOGIN_PATH;
  if (!param.startsWith("/")) return POST_LOGIN_PATH;
  // "//host" is protocol-relative; "/\host" is the same thing to browsers
  // that normalise backslashes.
  if (param.startsWith("//") || param.startsWith("/\\")) return POST_LOGIN_PATH;
  return param;
}

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
