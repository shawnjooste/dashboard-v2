import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");
  return (
    <AppShell email={me.profile.email} role="rocking_staff">
      {children}
    </AppShell>
  );
}
