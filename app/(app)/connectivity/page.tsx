import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getConnectivityLines } from "@/lib/views/connectivity";
import { KIND_LABELS } from "@/lib/connectivity-helpers";
import { Card, PageHeader, StatusPill } from "@/components/ui";

const fmtSince = (iso: string) => iso.replace("T", " ").slice(0, 16);

export default async function ConnectivityPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) redirect("/");
  if (!me.profile.client_id) redirect("/");

  const lines = await getConnectivityLines(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectivity"
        subtitle="Your internet lines — what you have and whether it's up right now."
      />
      {lines.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No connectivity services on your account yet.</p>
        </Card>
      ) : (
        lines.map((l) => (
          <Card key={l.id}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-ink">{l.label}</span>
                  {l.status &&
                    (l.status.up === true ? (
                      <StatusPill tone="good" label="Online" />
                    ) : l.status.up === false ? (
                      <StatusPill
                        tone="bad"
                        label={l.status.downSince ? `Down since ${fmtSince(l.status.downSince)}` : "Down"}
                      />
                    ) : (
                      <StatusPill tone="warn" label="Status unavailable" />
                    ))}
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {[KIND_LABELS[l.kind] ?? l.kind, l.speed, l.provider].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Link
                href={`/support/new?subject=${encodeURIComponent(`Line problem: ${l.label}`)}`}
                className="ml-auto shrink-0 rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
              >
                Report a problem
              </Link>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
