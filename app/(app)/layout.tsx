import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { trackVisit } from "@/lib/track";
import { allowedFeatures, toOverrides, FEATURE_HREFS } from "@/lib/feature-access";
import { hasConnectivity } from "@/lib/views/connectivity";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { CrispChat } from "@/components/CrispChat";
import { getSupportStatus } from "@/lib/views/support-packages";
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
  let connectivityEnabled = false;
  let suspensionNote: string | null = null;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, { data: firstName }, hasLines] = await Promise.all([
      supabase.from("clients").select("name, xero_contact_id, suspended_at, suspension_note").eq("id", me.profile.client_id).maybeSingle(),
      // Read the caller's own name via SECURITY DEFINER, not the RLS people query:
      // a person row stranded under a different client would be hidden by RLS and
      // loop this gate back to /welcome forever.
      me.profile.person_id
        ? supabase.rpc("my_first_name")
        : Promise.resolve({ data: null }),
      hasConnectivity(me.profile.client_id),
    ]);
    accountName = client?.name ?? null;
    billingEnabled = !!client?.xero_contact_id;
    connectivityEnabled = hasLines;
    // Non-null suspended_at is the flag; the note is what they actually read.
    suspensionNote = client?.suspended_at
      ? (client.suspension_note ?? "Some of your services are currently suspended.")
      : null;
    // First-login gate: capture the user's name before they use the portal.
    // Skipped while a staff member is impersonating — saving is a write, which
    // the read-only impersonation guard blocks, so forcing it would dead-end.
    if (!marker && me.profile.person_id && !firstName) redirect("/welcome");
  }

  const allowed = allowedFeatures(me.profile.role, toOverrides(me.profile.feature_overrides));
  // Connectivity shows only for clients who actually have lines (billing pattern).
  if (!connectivityEnabled) allowed.delete("connectivity");

  // Live chat is a tier perk: only mount it for packages that include it, and
  // never while impersonating (a staff member shouldn't open a chat as the
  // client). Identity is passed through so nobody is asked for their email.
  const crispId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
  let chat: { tier: string; name: string | null } | null = null;
  if (crispId && !marker && me.profile.client_id) {
    const status = await getSupportStatus(me.profile.client_id);
    if (status.pkg?.hasChat) {
      chat = { tier: status.planLabel ?? status.pkg.name, name: null };
    }
  }

  return (
    <AppShell
      email={me.profile.email}
      role={me.profile.role}
      impersonating={marker?.email ?? null}
      accountName={accountName}
      billingEnabled={billingEnabled}
      allowedHrefs={[...allowed].map((f) => FEATURE_HREFS[f])}
      suspensionNote={suspensionNote}
    >
      {children}
      {chat && crispId && (
        <CrispChat
          websiteId={crispId}
          email={me.profile.email}
          name={chat.name}
          company={accountName}
          tier={chat.tier}
        />
      )}
    </AppShell>
  );
}
