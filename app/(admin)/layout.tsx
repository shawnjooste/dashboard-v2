import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";
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
  return (
    <AppShell
      email={me.profile.email}
      role="rocking_staff"
      impersonating={marker?.email ?? null}
    >
      {children}
    </AppShell>
  );
}
