import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolvePendingAccess } from "@/lib/auth/pending-access";
import { staffRedirectFor, intendedPath } from "@/lib/auth/routing";
import { trackVisit } from "@/lib/track";
import { allowedFeatures, toOverrides, FEATURE_HREFS } from "@/lib/feature-access";
import { hasConnectivity } from "@/lib/views/connectivity";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { getActiveIncidents, getStatusIndicator } from "@/lib/views/status";
import { bannerIncident, chatOpenedByIncident } from "@/lib/incident-mode";
import { worstType } from "@/lib/status-helpers";
import { CrispChat } from "@/components/CrispChat";
import { getSupportStatus } from "@/lib/views/support-packages";
import { MARKER_COOKIE, decodeMarker } from "@/lib/impersonation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const rawPath = h.get("x-pathname");
  const pathname = rawPath ?? "/";

  const me = await getCurrentProfile();
  if (!me.authenticated) {
    const next = intendedPath(pathname, h.get("x-search") ?? "");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (me.profile.role === "rocking_staff") redirect(staffRedirectFor(pathname));
  const marker = decodeMarker((await cookies()).get(MARKER_COOKIE)?.value);

  const trackable = { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id };
  // Post-response so tracking adds zero latency to the page.
  after(() => trackVisit(trackable, pathname));

  // Nobody without a company gets further than the holding page and the status
  // page. Fall back to the holding path if the header is ever missing — any
  // other default would redirect /pending to itself forever.
  const gate = resolvePendingAccess({
    status: me.profile.status,
    hasClient: me.profile.client_id !== null,
    pathname: rawPath ?? "/pending",
  });
  if (gate.redirectTo) redirect(gate.redirectTo);
  if (gate.mode !== "full") {
    // Everything below this point is client-scoped and meaningless without a
    // company, so skip it entirely. The status dot still works: it reads the
    // global incidents this user can see.
    return (
      <AppShell
        email={me.profile.email}
        role={me.profile.role}
        impersonating={marker?.email ?? null}
        statusType={gate.mode === "pending" ? await getStatusIndicator() : null}
        pendingMode={gate.mode}
      >
        {children}
      </AppShell>
    );
  }

  let accountName: string | null = null;
  let fullName: string | null = null;
  let billingEnabled = false;
  let connectivityEnabled = false;
  let suspensionNote: string | null = null;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, { data: firstName }, { data: personName }, hasLines] = await Promise.all([
      supabase.from("clients").select("name, xero_contact_id, suspended_at, suspension_note").eq("id", me.profile.client_id).maybeSingle(),
      // Read the caller's own name via SECURITY DEFINER, not the RLS people query:
      // a person row stranded under a different client would be hidden by RLS and
      // loop this gate back to /welcome forever.
      me.profile.person_id
        ? supabase.rpc("my_first_name")
        : Promise.resolve({ data: null }),
      // Full name, for the chat identity. Kept separate from the gate above:
      // the gate must stay keyed on the first name specifically, or someone
      // with only a display name would skip /welcome.
      me.profile.person_id
        ? supabase.rpc("my_full_name")
        : Promise.resolve({ data: null }),
      hasConnectivity(me.profile.client_id),
    ]);
    accountName = client?.name ?? null;
    fullName = personName ?? null;
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

  // One read of the active incidents this person can see, three uses: the
  // colour of the status dot, whether to run the outage banner, and whether
  // this is "incident mode" — chat open to everyone affected regardless of
  // tier. RLS scopes the rows, so a client-scoped incident reaches only its
  // own clients.
  const activeIncidents = await getActiveIncidents();
  const statusType = worstType(activeIncidents.map((i) => i.type));
  const banner = bannerIncident(activeIncidents);
  const incidentChat = chatOpenedByIncident(activeIncidents);
  const allowed = allowedFeatures(me.profile.role, toOverrides(me.profile.feature_overrides));
  // Connectivity shows only for clients who actually have lines (billing pattern).
  if (!connectivityEnabled) allowed.delete("connectivity");

  // Live chat is a tier perk: only mount it for packages that include it —
  // unless an incident has opened it to everyone affected, which is the point
  // of incident mode. Never while impersonating (a staff member shouldn't open
  // a chat as the client). Identity is passed through so nobody is asked for
  // their email.
  const crispId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
  let chat: { tier: string; name: string | null; incident: string | null } | null = null;
  if (crispId && !marker && me.profile.client_id) {
    const status = await getSupportStatus(me.profile.client_id);
    if (status.pkg?.hasChat || incidentChat) {
      chat = {
        tier: status.planLabel ?? status.pkg?.name ?? "—",
        // Full name, so three Moniques are three people in the inbox.
        name: fullName,
        // Tells the agent why a free-tier client is in the chat at all.
        incident: incidentChat ? (banner?.title ?? "Incident") : null,
      };
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
      statusType={statusType}
      incident={banner ? { title: banner.title, chatOpen: incidentChat } : null}
    >
      {children}
      {chat && crispId && (
        <CrispChat
          websiteId={crispId}
          email={me.profile.email}
          name={chat.name}
          company={accountName}
          tier={chat.tier}
          incident={chat.incident}
        />
      )}
    </AppShell>
  );
}
