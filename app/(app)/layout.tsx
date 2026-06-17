import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MARKER_COOKIE, decodeMarker } from "@/lib/impersonation";

function isNextControlFlow(e: unknown): boolean {
  const d = (e as { digest?: unknown })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d === "NEXT_NOT_FOUND");
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
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
    if (me.profile.person_id && !person?.first_name) redirect("/welcome");
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
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-lg font-bold text-brand">App layout error (debug)</h1>
        <p className="text-sm text-muted">Temporary — paste this to your engineer.</p>
        <pre className="overflow-auto rounded-lg border border-line bg-line-soft p-4 text-[11px] leading-relaxed text-ink-2">
          {e instanceof Error ? `${e.name}: ${e.message}\n\n${e.stack ?? ""}` : String(e)}
        </pre>
      </div>
    );
  }
}
