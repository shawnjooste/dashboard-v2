import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/** Enrol a profile in the onboarding sequence. Best-effort by design: an
 *  invite must never fail because the drip could not be started, so this
 *  swallows and logs. Idempotent — re-enrolling an existing row is ignored,
 *  which keeps `enrolled_at` (and therefore every day floor) stable. */
export async function enrolInOnboarding(profileId: string): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from("onboarding_sequence_state")
      .upsert({ profile_id: profileId }, { onConflict: "profile_id", ignoreDuplicates: true });
    if (error) console.error("enrolInOnboarding failed:", error.message);
  } catch (e) {
    console.error("enrolInOnboarding failed:", e);
  }
}
