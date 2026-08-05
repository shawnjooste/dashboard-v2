import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { StatusView } from "@/components/status/StatusView";

/** Staff status page — same view as the client one, plus the post/update/
 *  resolve controls, which StatusView renders for staff. */
export default async function AdminStatusPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");
  return <StatusView />;
}
