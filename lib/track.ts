import { createServiceClient } from "@/lib/supabase/service";
import { isLoginGap, sectionFromPath } from "@/lib/activity-helpers";

type TrackableProfile = { id: string; role: string; client_id: string | null };

/** Record a section visit (deduped per hour by the DB) and derive a login
 *  event after >= 8 quiet hours. Client users only; failures are swallowed —
 *  tracking must never break or slow a page. */
export async function trackVisit(profile: TrackableProfile, pathname: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff" || !profile.client_id) return;
    const section = sectionFromPath(pathname);
    const service = createServiceClient();
    const { data: inserted } = await service
      .from("portal_activity")
      .upsert(
        { profile_id: profile.id, client_id: profile.client_id, kind: "visit", section },
        { onConflict: "profile_id,kind,section,hour_bucket", ignoreDuplicates: true },
      )
      .select("id");
    // Only a genuinely new visit row can be the first sign of a session.
    if (!inserted?.length) return;
    const { data: prior } = await service
      .from("portal_activity")
      .select("occurred_at")
      .eq("profile_id", profile.id)
      .neq("id", inserted[0].id)
      .order("occurred_at", { ascending: false })
      .limit(1);
    const minutes = prior?.length
      ? Math.round((Date.now() - new Date(prior[0].occurred_at).getTime()) / 60000)
      : null;
    if (isLoginGap(minutes)) {
      await service
        .from("portal_activity")
        .upsert(
          { profile_id: profile.id, client_id: profile.client_id, kind: "login", section: "session" },
          { onConflict: "profile_id,kind,section,hour_bucket", ignoreDuplicates: true },
        );
    }
  } catch (e) {
    console.error("trackVisit failed:", e);
  }
}

/** Record an explicit portal action, e.g. ("ticket_created", subject). */
export async function trackAction(profile: TrackableProfile, section: string, detail?: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff" || !profile.client_id) return;
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
