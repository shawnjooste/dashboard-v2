import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";

export default async function AppHome() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  const path = resolveLandingPath({
    authenticated: true,
    role: me.profile.role,
    status: me.profile.status,
    hasClient: me.profile.client_id !== null,
    hasClaimedDevice: me.hasClaimedDevice,
  });
  if (path !== "/app") redirect(path);

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Your dashboard</h1>
      <p className="mt-2 text-gray-600">Device views arrive in the next slice.</p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
