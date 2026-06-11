import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { MARKER_COOKIE, BACKUP_PREFIX, decodeMarker, isAuthCookie } from "@/lib/impersonation";

/**
 * Ends impersonation by RE-MINTING the staff member's own session (robust to
 * any cookie state — no backup/restore). Cookies are written onto the redirect
 * response directly so they reliably reach the browser.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/admin", request.url), { status: 303 });
  const marker = decodeMarker(request.cookies.get(MARKER_COOKIE)?.value);
  if (!marker) return response;

  // Resolve the admin email (from the marker, or the audit log as a fallback).
  const service = createServiceClient();
  let adminEmail = marker.adminEmail;
  if (!adminEmail && marker.logId) {
    const { data: log } = await service
      .from("impersonation_log")
      .select("staff_profile_id")
      .eq("id", marker.logId)
      .maybeSingle();
    if (log) {
      const { data: staff } = await service
        .from("profiles")
        .select("email")
        .eq("id", log.staff_profile_id)
        .maybeSingle();
      adminEmail = staff?.email ?? "";
    }
  }

  // A supabase client whose cookie writes land on THIS redirect response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    },
  );

  if (adminEmail) {
    const { data: link } = await service.auth.admin.generateLink({ type: "magiclink", email: adminEmail });
    if (link?.properties?.hashed_token) {
      // verifyOtp writes the admin's fresh session onto `response`.
      await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    }
  }

  // Clear the marker + any legacy backup cookies.
  response.cookies.delete(MARKER_COOKIE);
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith(BACKUP_PREFIX) || (isAuthCookie(c.name) && !adminEmail)) {
      response.cookies.delete(c.name);
    }
  }

  // Stamp the audit row (best effort).
  try {
    if (marker.logId) {
      await service.from("impersonation_log").update({ ended_at: new Date().toISOString() }).eq("id", marker.logId);
    }
  } catch {
    /* must not block the exit */
  }

  return response;
}
