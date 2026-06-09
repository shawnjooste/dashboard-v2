import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";

export default async function PendingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status === "active" && me.profile.client_id) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold">We&apos;re setting up your access</h1>
        <p className="text-gray-600">
          Your account <strong>{me.profile.email}</strong> isn&apos;t linked to a
          client yet. Rocking has been notified and will connect you shortly.
        </p>
        <form action="/auth/signout" method="post">
          <button className="rounded border px-3 py-1 text-sm">Sign out</button>
        </form>
      </div>
    </main>
  );
}
