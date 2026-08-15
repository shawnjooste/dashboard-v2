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
 *  "//evil.com" as off-site, so it must never reach it. Tab/LF/CR are
 *  rejected outright rather than stripped: the WHATWG URL parser (and every
 *  browser) strips them before parsing, so "/\t/evil.com" is indistinguishable
 *  from "//evil.com" by the time it's resolved — stripping here and continuing
 *  would just re-open the same hole one step later. */
export function safeNext(param: string | null | undefined): string {
  if (!param) return POST_LOGIN_PATH;
  if (!param.startsWith("/")) return POST_LOGIN_PATH;
  // "//host" is protocol-relative; "/\host" is the same thing to browsers
  // that normalise backslashes.
  if (param.startsWith("//") || param.startsWith("/\\")) return POST_LOGIN_PATH;
  // Tab/LF/CR anywhere in the value get stripped by URL parsing before the
  // "//" check above would see them — reject rather than sanitise. This is
  // also the full set of C0/C1 control characters (\x00-\x1f, \x7f-\x9f) plus
  // the Unicode line/paragraph separators U+2028/U+2029: beyond the "//"
  // rewrite, several of these (\0, \b, \v, \f, U+2028, U+2029) throw
  // ERR_INVALID_CHAR from Node's HTTP header validation when they reach
  // redirect() — and unlike the confirm route, which re-parses through
  // new URL() and percent-encodes, the login server action passes this
  // straight to redirect(), so a value that gets this far can 500 *after*
  // the OTP has already been verified, leaving the user signed in but
  // staring at an error page.
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(param)) return POST_LOGIN_PATH;
  return param;
}

/** Where to send someone back to after they sign in. Keeps the query string,
 *  because a Paystack return carries its reference there and losing it breaks
 *  the payment-verify fallback. Bouncing back to /login would loop, so that
 *  one case resolves to the default. */
export function intendedPath(pathname: string, search: string): string {
  if (pathname === "/login") return POST_LOGIN_PATH;
  return `${pathname}${search}`;
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
