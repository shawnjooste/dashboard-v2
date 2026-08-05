import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { StatusView } from "@/components/status/StatusView";

/** Client-facing status page. Staff get the same view (with controls) at
 *  /admin/status — the (app) layout redirects them away from here. */
export default async function StatusPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  return <StatusView />;
}
