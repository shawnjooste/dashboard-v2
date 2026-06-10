import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MARKER_COOKIE,
  BACKUP_PREFIX,
  decodeMarker,
  isAuthCookie,
  originalName,
} from "@/lib/impersonation";

/** Ends impersonation: restores the staff session from backups. */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const marker = decodeMarker(cookieStore.get(MARKER_COOKIE)?.value);
  if (!marker) {
    return NextResponse.redirect(new URL("/admin", request.url), { status: 303 });
  }

  const all = cookieStore.getAll();
  const secure = process.env.NODE_ENV === "production";

  // Delete the target's live auth cookies first (chunk counts may differ).
  for (const c of all) {
    if (isAuthCookie(c.name)) cookieStore.delete(c.name);
  }
  // Restore staff session from backups, then remove backups + marker.
  for (const c of all) {
    if (c.name.startsWith(BACKUP_PREFIX)) {
      const orig = originalName(c.name);
      if (orig) {
        cookieStore.set(orig, c.value, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
        });
      }
      cookieStore.delete(c.name);
    }
  }
  cookieStore.delete(MARKER_COOKIE);

  // Stamp the audit row (best effort).
  try {
    const service = createServiceClient();
    await service
      .from("impersonation_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", marker.logId);
  } catch {
    // audit stamping must not block the exit
  }

  return NextResponse.redirect(new URL("/admin", request.url), { status: 303 });
}
