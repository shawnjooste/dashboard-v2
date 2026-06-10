"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import {
  MARKER_COOKIE,
  backupName,
  encodeMarker,
  isAuthCookie,
} from "@/lib/impersonation";

/**
 * Staff-only: swap the session to a target client user ("Sign in as").
 * Backs up the staff session cookies first; Exit restores them.
 */
export async function startImpersonation(formData: FormData) {
  const targetId = String(formData.get("profile_id") ?? "");
  if (!targetId) throw new Error("missing target");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may sign in as a user");
  }

  const cookieStore = await cookies();
  if (cookieStore.get(MARKER_COOKIE)) {
    throw new Error("already impersonating — exit first");
  }

  // Validate the target with the service client (bypasses RLS for the read,
  // but the guards here are what matter).
  const service = createServiceClient();
  const { data: target } = await service
    .from("profiles")
    .select("id, email, role, status, client_id")
    .eq("id", targetId)
    .maybeSingle();
  if (!target) throw new Error("user not found");
  if (target.role === "rocking_staff") throw new Error("cannot sign in as staff");
  if (target.status !== "active" || !target.client_id) {
    throw new Error("user is not active yet");
  }

  // Audit first.
  const { data: log, error: logErr } = await service
    .from("impersonation_log")
    .insert({
      staff_profile_id: me.profile.id,
      target_profile_id: target.id,
      target_email: target.email,
    })
    .select("id")
    .single();
  if (logErr) throw new Error("could not write audit log");

  // Mint a session for the target (no email is sent).
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: target.email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error("could not create session for user");
  }

  // Back up the staff auth cookies BEFORE verifyOtp overwrites them.
  const secure = process.env.NODE_ENV === "production";
  for (const c of cookieStore.getAll()) {
    if (isAuthCookie(c.name)) {
      cookieStore.set(backupName(c.name), c.value, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
    }
  }

  // verifyOtp on the cookie-writing client swaps the live session to the target.
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) {
    // Roll back: remove backups, leave the original (untouched) session alone.
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("imp-bak.")) cookieStore.delete(c.name);
    }
    throw new Error("could not start the session");
  }

  cookieStore.set(MARKER_COOKIE, encodeMarker({ logId: log.id, email: target.email }), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect("/");
}
