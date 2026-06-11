import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getM365View } from "@/lib/views/m365";
import { M365View } from "@/components/M365View";
import { PageHeader } from "@/components/ui";

export default async function M365Page() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  // Org-level M365 posture is a manager concern.
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const view = await getM365View(me.profile.client_id);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Microsoft 365"
        subtitle="How your company's email and accounts are protected, including two-step sign-in."
      />
      <M365View view={view} />
    </div>
  );
}
