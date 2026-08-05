import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { Card } from "@/components/ui";

/** Holding page for someone who isn't linked to a company yet. Rendered inside
 *  the app shell, whose sidebar is trimmed to Status (or nothing, if they were
 *  rejected) by the pending gate in the layout. */
export default async function PendingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status === "active" && me.profile.client_id) redirect("/");

  const rejected = me.profile.status === "rejected";

  return (
    <Card className="mx-auto max-w-lg">
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
              Your account <strong className="text-ink-2">{me.profile.email}</strong>{" "}
              isn&apos;t linked to a company yet. Rocking has been notified and will connect you
              shortly.
            </>
          )}
        </p>
        {!rejected && (
          <p className="text-sm text-muted">
            In the meantime you can{" "}
            <Link href="/status" className="font-semibold text-ink-2 underline hover:text-ink">
              check service status
            </Link>{" "}
            for any current outages.
          </p>
        )}
      </div>
    </Card>
  );
}
