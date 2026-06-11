// Helpers for staff "Sign in as" impersonation. Pure functions here are unit
// tested; cookie I/O happens in the actions/route that use them.

export const MARKER_COOKIE = "imp";
export const BACKUP_PREFIX = "imp-bak."; // legacy; cleared on exit for in-flight markers

// `email` = the impersonated target (shown in the banner).
// `adminEmail` = the staff member, used to re-mint their session on exit.
export type ImpersonationMarker = { logId: string; email: string; adminEmail: string };

/** Is this a Supabase auth session cookie (incl. chunked .0/.1 variants)? */
export function isAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

export function encodeMarker(m: ImpersonationMarker): string {
  return Buffer.from(JSON.stringify(m), "utf8").toString("base64url");
}

export function decodeMarker(value: string | undefined): ImpersonationMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed?.logId === "string" && typeof parsed?.email === "string") {
      return { logId: parsed.logId, email: parsed.email, adminEmail: parsed.adminEmail ?? "" };
    }
    return null;
  } catch {
    return null;
  }
}
