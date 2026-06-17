import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MARKER_COOKIE, decodeMarker } from "@/lib/impersonation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role === "rocking_staff") redirect("/admin");
  const marker = decodeMarker((await cookies()).get(MARKER_COOKIE)?.value);

  let accountName: string | null = null;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, { data: person }] = await Promise.all([
      supabase.from("clients").select("name").eq("id", me.profile.client_id).maybeSingle(),
      me.profile.person_id
        ? supabase.from("people").select("first_name").eq("id", me.profile.person_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    accountName = client?.name ?? null;
    // First-login gate: capture the user's name before they use the portal.
    // Skipped while a staff member is impersonating — saving is a write, which
    // the read-only impersonation guard blocks, so forcing it would dead-end.
    if (!marker && me.profile.person_id && !person?.first_name) redirect("/welcome");
  }

  return (
    <AppShell
      email={me.profile.email}
      role={me.profile.role}
      impersonating={marker?.email ?? null}
      accountName={accountName}
    >
      {children}
    </AppShell>
  );
}
