import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getConnectivityLines } from "@/lib/views/connectivity";
import { ConnectivityLineCard } from "@/components/ConnectivityLineCard";
import { Card, PageHeader } from "@/components/ui";

export default async function ConnectivityPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) redirect("/");
  if (!me.profile.client_id) redirect("/");

  const lines = await getConnectivityLines(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectivity"
        subtitle="Your internet lines — how they're set up and whether they're up right now."
      />
      {lines.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No connectivity services on your account yet.</p>
        </Card>
      ) : (
        lines.map((l) => <ConnectivityLineCard key={l.id} line={l} />)
      )}
    </div>
  );
}
