import { createServiceClient } from "@/lib/supabase/service";
import { isLoginGap, sectionFromPath } from "@/lib/activity-helpers";

type TrackableProfile = { id: string; role: string; client_id: string | null };

/** Record a section visit (deduped per hour by the DB) and derive a login
 *  event after >= 8 quiet hours. Client users only; failures are swallowed —
 *  tracking must never break or slow a page.
 *
 *  A null client_id is kept, not skipped: someone waiting to be assigned to a
 *  company can still reach the status page, and those visits are exactly the
 *  ones worth seeing in the feed. portal_activity.client_id is nullable and
 *  the activity view already renders rows with no company. */
export async function trackVisit(profile: TrackableProfile, pathname: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff") return;
    const section = sectionFromPath(pathname);
    const service = createServiceClient();
    // Deduped per hour inside the function — the partial unique index it
    // relies on can't be inferred through PostgREST's upsert.
    const { data: insertedId } = await service.rpc("record_portal_visit", {
      p_profile_id: profile.id,
      // The type generator marks every uuid arg non-nullable; Postgres accepts
      // null here, and must — a user with no company still gets logged.
      p_client_id: profile.client_id as string,
      p_kind: "visit",
      p_section: section,
    });
    // Only a genuinely new visit row can be the first sign of a session.
    if (!insertedId) return;
    const { data: prior } = await service
      .from("portal_activity")
      .select("occurred_at")
      .eq("profile_id", profile.id)
      .neq("id", insertedId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    const minutes = prior?.length
      ? Math.round((Date.now() - new Date(prior[0].occurred_at).getTime()) / 60000)
      : null;
    if (isLoginGap(minutes)) {
      await service.rpc("record_portal_visit", {
        p_profile_id: profile.id,
        // The type generator marks every uuid arg non-nullable; Postgres accepts
      // null here, and must — a user with no company still gets logged.
      p_client_id: profile.client_id as string,
        p_kind: "login",
        p_section: "session",
      });
    }
  } catch (e) {
    console.error("trackVisit failed:", e);
  }
}

/** Record an explicit portal action, e.g. ("ticket_created", subject). */
export async function trackAction(profile: TrackableProfile, section: string, detail?: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff") return;
    await createServiceClient().from("portal_activity").insert({
      profile_id: profile.id,
      client_id: profile.client_id,
      kind: "action",
      section,
      detail: detail?.slice(0, 200) ?? null,
    });
  } catch (e) {
    console.error("trackAction failed:", e);
  }
}
