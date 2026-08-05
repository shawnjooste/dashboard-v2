import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";
import { getStatusIndicator } from "@/lib/views/status";
import { MARKER_COOKIE, decodeMarker } from "@/lib/impersonation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");
  const marker = decodeMarker((await cookies()).get(MARKER_COOKIE)?.value);
  const statusType = await getStatusIndicator();
  return (
    <AppShell
      email={me.profile.email}
      role="rocking_staff"
      impersonating={marker?.email ?? null}
      statusType={statusType}
    >
      {children}
    </AppShell>
  );
}
