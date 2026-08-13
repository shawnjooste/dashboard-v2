import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { allowedFeatures, toOverrides, FEATURE_HREFS } from "@/lib/feature-access";
import { hasConnectivity } from "@/lib/views/connectivity";
import { createClient } from "@/lib/supabase/server";
import { mobileMenuGroups } from "@/lib/nav";
import { PageHeader } from "@/components/ui";

/** Everything that isn't a tab, for phones. Hidden at md+ — the desktop
 *  sidebar already lists all of this, so the route exists but is unreachable
 *  by navigation there. */
export default async function MorePage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");

  let billingEnabled = false;
  let connectivityEnabled = false;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, hasLines] = await Promise.all([
      supabase.from("clients").select("xero_contact_id").eq("id", me.profile.client_id).maybeSingle(),
      hasConnectivity(me.profile.client_id),
    ]);
    billingEnabled = !!client?.xero_contact_id;
    connectivityEnabled = hasLines;
  }

  const allowed = allowedFeatures(me.profile.role, toOverrides(me.profile.feature_overrides));
  if (!connectivityEnabled) allowed.delete("connectivity");

  const groups = mobileMenuGroups({
    role: me.profile.role,
    allowedHrefs: [...allowed].map((f) => FEATURE_HREFS[f]),
    billingEnabled,
  });

  return (
    <div className="space-y-6 md:hidden">
      <PageHeader title="More" subtitle="Everything else in your account." />
      {groups.map((g) => (
        <section key={g.label || "main"}>
          {g.label && (
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.6px] text-faint">
              {g.label}
            </h2>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="flex min-h-[52px] items-center justify-between border-b border-line-soft px-4 text-[15px] font-medium text-ink last:border-0"
              >
                {item.label}
                <span aria-hidden className="text-faint">
                  {item.external ? "↗" : "›"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
