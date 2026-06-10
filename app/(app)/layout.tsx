import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "My machine",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role === "rocking_staff") redirect("/admin");
  return (
    <AppShell email={me.profile.email} roleLabel={ROLE_LABEL[me.profile.role] ?? "Client"}>
      {children}
    </AppShell>
  );
}
