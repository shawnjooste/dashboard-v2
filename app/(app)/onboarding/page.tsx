import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { claimDevice } from "./actions";

export default async function OnboardingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status !== "active" || !me.profile.client_id) redirect("/pending");
  if (me.hasClaimedDevice) redirect("/");

  const supabase = await createClient();
  const { data: devices } = await supabase.rpc("claimable_devices");

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Claim your machine</h1>
      <p className="mt-2 text-gray-600">
        Pick the computer that&apos;s yours so we can show you its health.
      </p>
      <ul className="mt-6 space-y-2">
        {(devices ?? []).map((d) => (
          <li key={d.id}>
            <form action={claimDevice}>
              <input type="hidden" name="device_id" value={d.id} />
              <button className="flex w-full items-center justify-between rounded border px-4 py-3 text-left hover:bg-gray-50">
                <span className="font-medium">{d.hostname}</span>
                <span className="text-sm text-gray-500">
                  {d.assigned_user_label ?? "unassigned"}
                </span>
              </button>
            </form>
          </li>
        ))}
        {(!devices || devices.length === 0) && (
          <li className="text-gray-500">
            No unclaimed machines found for your company yet. Check back soon.
          </li>
        )}
      </ul>
      <form action="/auth/signout" method="post" className="mt-8">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
