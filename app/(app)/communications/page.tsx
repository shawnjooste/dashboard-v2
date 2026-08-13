import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getMyCommunications } from "@/lib/views/communications";
import { categoryLabel, formatRecipients } from "@/lib/communications-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { PortalUpdatesToggle } from "@/components/PortalUpdatesToggle";

const fmtDate = (ts: string) => ts.slice(0, 10);

export default async function CommunicationsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");

  const emails = await getMyCommunications();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        subtitle="Every email we've sent you, in one place — invites, quotes, bookings and updates."
      />

      <Card>
        <CardHeader title="Portal updates" />
        <div className="px-4 py-3.5">
          <PortalUpdatesToggle
            profileId={me.profile.id}
            optedOut={me.profile.portal_updates_opt_out}
          />
          <p className="mt-2 text-[13px] text-muted">
            Occasional news about new portal features. Quotes, bookings and support emails are
            always sent.
          </p>
        </div>
      </Card>

      {emails.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            Nothing yet — emails we send you will appear here.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Emails" count={emails.length} />
          {emails.map((e) => (
            <details key={e.id} className="border-b border-line-soft last:border-0">
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-4 py-3 hover:bg-canvas">
                <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
                  {categoryLabel(e.category)}
                </span>
                <span className="min-w-0 break-words text-sm font-medium text-ink">{e.subject}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-faint">{fmtDate(e.sentAt)}</span>
              </summary>
              <div className="px-4 pb-4">
                <p className="mb-2 break-words text-xs text-muted">To: {formatRecipients(e.toEmails)}</p>
                {/* Stored HTML renders in a sandboxed frame — never injected into
                    this document — so a templated email can't script the portal. */}
                <iframe
                  title={e.subject}
                  sandbox=""
                  srcDoc={e.html}
                  className="h-[520px] w-full rounded-lg border border-line bg-white"
                />
              </div>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}
