import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getM365View } from "@/lib/views/m365";
import { M365View } from "@/components/M365View";

export default async function M365Page() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  // Org-level M365 posture is a manager concern.
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const view = await getM365View(me.profile.client_id);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Microsoft 365</h1>
      <M365View view={view} />
    </div>
  );
}
