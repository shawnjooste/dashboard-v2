import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { claimDevice } from "./actions";
import { PageHeader, Card } from "@/components/ui";

export default async function OnboardingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status !== "active" || !me.profile.client_id) redirect("/pending");
  if (me.hasClaimedDevice) redirect("/");

  const supabase = await createClient();
  const { data: devices } = await supabase.rpc("claimable_devices");

  return (
    <main className="mx-auto max-w-lg space-y-6 p-8">
      <PageHeader
        title="Claim your computer"
        subtitle="Pick the computer that's yours so we can show you its health."
      />
      <Card>
        {(devices ?? []).map((d) => (
          <form key={d.id} action={claimDevice}>
            <input type="hidden" name="device_id" value={d.id} />
            <button className="flex w-full items-center justify-between border-b border-line-soft px-4 py-3.5 text-left last:border-0 hover:bg-canvas">
              <span className="font-medium text-ink">{d.hostname}</span>
              <span className="text-[13px] text-muted">
                {d.assigned_user_label ?? "Not yet assigned"}
              </span>
            </button>
          </form>
        ))}
        {(!devices || devices.length === 0) && (
          <p className="px-4 py-4 text-sm text-muted">
            No unclaimed computers were found for your company yet. Check back soon.
          </p>
        )}
      </Card>
      <form action="/auth/signout" method="post">
        <button className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
          Sign out
        </button>
      </form>
    </main>
  );
}
