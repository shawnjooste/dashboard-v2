import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/domain";

export type CurrentProfile =
  | { authenticated: false }
  | { authenticated: true; profile: Profile; hasClaimedDevice: boolean };

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authenticated: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return {
      authenticated: true,
      profile: {
        id: user.id,
        email: user.email ?? "",
        client_id: null,
        role: "client_member",
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      hasClaimedDevice: false,
    };
  }

  const { count } = await supabase
    .from("device_assignments")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id);

  return { authenticated: true, profile, hasClaimedDevice: (count ?? 0) > 0 };
}
