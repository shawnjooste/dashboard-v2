import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { Card } from "@/components/ui";

export default async function PendingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status === "active" && me.profile.client_id) redirect("/");

  const rejected = me.profile.status === "rejected";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <div className="space-y-3 p-8 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-ink">
            {rejected ? "Access wasn't approved" : "We're setting up your access"}
          </h1>
          <p className="text-sm text-muted">
            {rejected ? (
              <>
                Your request to join wasn&apos;t approved for{" "}
                <strong className="text-ink-2">{me.profile.email}</strong>. If you think this is a
                mistake, please contact your IT administrator.
              </>
            ) : (
              <>
                Your account <strong className="text-ink-2">{me.profile.email}</strong> isn&apos;t
                linked to a company yet. Rocking has been notified and will connect you shortly.
              </>
            )}
          </p>
          <form action="/auth/signout" method="post" className="pt-2">
            <button className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
              Sign out
            </button>
          </form>
        </div>
      </Card>
    </main>
  );
}
