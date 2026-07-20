import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { trackVisit } from "@/lib/track";
import { allowedFeatures, toOverrides, FEATURE_HREFS } from "@/lib/feature-access";
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

  const pathname = (await headers()).get("x-pathname") ?? "/";
  const trackable = { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id };
  // Post-response so tracking adds zero latency to the page.
  after(() => trackVisit(trackable, pathname));

  let accountName: string | null = null;
  let billingEnabled = false;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, { data: firstName }] = await Promise.all([
      supabase.from("clients").select("name, xero_contact_id").eq("id", me.profile.client_id).maybeSingle(),
      // Read the caller's own name via SECURITY DEFINER, not the RLS people query:
      // a person row stranded under a different client would be hidden by RLS and
      // loop this gate back to /welcome forever.
      me.profile.person_id
        ? supabase.rpc("my_first_name")
        : Promise.resolve({ data: null }),
    ]);
    accountName = client?.name ?? null;
    billingEnabled = !!client?.xero_contact_id;
    // First-login gate: capture the user's name before they use the portal.
    // Skipped while a staff member is impersonating — saving is a write, which
    // the read-only impersonation guard blocks, so forcing it would dead-end.
    if (!marker && me.profile.person_id && !firstName) redirect("/welcome");
  }

  const allowed = allowedFeatures(me.profile.role, toOverrides(me.profile.feature_overrides));

  return (
    <AppShell
      email={me.profile.email}
      role={me.profile.role}
      impersonating={marker?.email ?? null}
      accountName={accountName}
      billingEnabled={billingEnabled}
      allowedHrefs={[...allowed].map((f) => FEATURE_HREFS[f])}
    >
      {children}
    </AppShell>
  );
}
