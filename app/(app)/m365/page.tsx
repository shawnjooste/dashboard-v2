import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getM365View } from "@/lib/views/m365";
import { getSampleM365View } from "@/lib/views/sample";
import { M365View } from "@/components/M365View";
import { SampleBanner } from "@/components/SampleBanner";
import { PageHeader } from "@/components/ui";

export default async function M365Page() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  // Org-level M365 posture is a manager concern.
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  let view = await getM365View(me.profile.client_id);
  let sample = false;
  if (!view.connected) {
    view = await getSampleM365View();
    sample = true;
  }

  return (
    <div className="space-y-6">
      {sample && <SampleBanner />}
      <PageHeader
        title="Microsoft 365"
        subtitle="How your company's email and accounts are protected, including two-step sign-in."
      />
      {/* Sample mode: drill-downs are disabled (no real users to list). */}
      <M365View view={view} usersHref={sample ? undefined : "/m365/users"} />
    </div>
  );
}
