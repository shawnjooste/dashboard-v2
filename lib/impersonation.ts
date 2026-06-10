// Helpers for staff "Sign in as" impersonation. Pure functions here are unit
// tested; cookie I/O happens in the actions/route that use them.

export const MARKER_COOKIE = "imp";
export const BACKUP_PREFIX = "imp-bak.";

export type ImpersonationMarker = { logId: string; email: string };

/** Is this a Supabase auth session cookie (incl. chunked .0/.1 variants)? */
export function isAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

export const backupName = (name: string): string => `${BACKUP_PREFIX}${name}`;

export function originalName(backup: string): string | null {
  return backup.startsWith(BACKUP_PREFIX) ? backup.slice(BACKUP_PREFIX.length) : null;
}

export function encodeMarker(m: ImpersonationMarker): string {
  return Buffer.from(JSON.stringify(m), "utf8").toString("base64url");
}

export function decodeMarker(value: string | undefined): ImpersonationMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed?.logId === "string" && typeof parsed?.email === "string") {
      return { logId: parsed.logId, email: parsed.email };
    }
    return null;
  } catch {
    return null;
  }
}
