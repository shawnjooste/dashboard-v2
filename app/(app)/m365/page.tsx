import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getM365View } from "@/lib/views/m365";
import { M365View } from "@/components/M365View";
import { PageHeader } from "@/components/ui";

export default async function M365Page() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "m365")) redirect("/");
  // Org-level M365 posture is a manager concern.
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const view = await getM365View(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Microsoft 365"
        subtitle="How your company's email and accounts are protected, including two-step sign-in."
      />
      <M365View view={view} usersHref="/m365/users" />
    </div>
  );
}
