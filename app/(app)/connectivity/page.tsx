import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createClient } from "@/lib/supabase/server";
import { getConnectivityLines } from "@/lib/views/connectivity";
import { ConnectivityLineCard } from "@/components/ConnectivityLineCard";
import { ConnectivityEnquiry } from "@/components/ConnectivityEnquiry";
import { PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function ConnectivityPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) redirect("/");
  if (!me.profile.client_id) redirect("/");

  const lines = await getConnectivityLines(me.profile.client_id);

  // Only needed for the enquiry form's contact default — skip the query when
  // the client already has lines and the form never renders.
  let contactName = "";
  if (lines.length === 0 && me.profile.person_id) {
    const supabase = await createClient();
    const { data: person } = await supabase
      .from("people")
      .select("display_name")
      .eq("id", me.profile.person_id)
      .maybeSingle();
    contactName = person?.display_name ?? "";
  }

  return (
    <div className="space-y-6">
      {/* the pull writes every 5 minutes; keep an open tab in step with it.
          Only where there's live data to refresh — on the empty state it would
          just risk interrupting someone typing an enquiry. */}
      {lines.length > 0 && <AutoRefresh seconds={60} />}
      <PageHeader
        title="Connectivity"
        subtitle="Your internet lines — how they're set up and whether they're up right now."
      />
      {lines.length === 0 ? (
        <ConnectivityEnquiry contactName={contactName} contactEmail={me.profile.email} />
      ) : (
        lines.map((l) => <ConnectivityLineCard key={l.id} line={l} />)
      )}
    </div>
  );
}
