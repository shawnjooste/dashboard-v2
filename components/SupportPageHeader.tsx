import { type ReactNode } from "react";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportStatus } from "@/lib/views/support-packages";
import { fmtMinutes } from "@/lib/support-package-helpers";
import { PageHeader } from "@/components/ui";

/** The /support header with the client's tier folded in: a pill next to the
 *  title (package name, or the bundle plan label) and a tier-aware subtitle
 *  with the hours meter for managers. One block — no separate banner card. */
export async function SupportPageHeader({ action }: { action?: ReactNode }) {
  const me = await getCurrentProfile();
  const generic = (
    <PageHeader
      title="Support"
      subtitle="Need a hand? Raise a ticket and a real person from our team will help you out."
      action={action}
    />
  );
  if (!me.authenticated || me.profile.role === "rocking_staff" || !me.profile.client_id) return generic;

  const status = await getSupportStatus(me.profile.client_id);
  const pkg = status.pkg;
  if (!pkg) return generic;

  const isManager = me.profile.role === "client_manager";
  const showMeter = !pkg.isDefault && pkg.includedMinutes > 0 && isManager;

  const subtitle = pkg.isDefault
    ? "Raise a ticket and a real person from our team will help you out. We respond as capacity allows — ask us about Business Care for guaranteed response times."
    : `Raise a ticket and a real person picks it up${pkg.slaHours ? ` — first response within ${pkg.slaHours} business hours` : ""}.${
        showMeter ? ` · ${fmtMinutes(status.usedMinutes)} of ${fmtMinutes(pkg.includedMinutes)} support hours used this month.` : ""
      }`;

  const title = (
    <span className="flex items-center gap-2.5">
      Support
      {!pkg.isDefault && (
        <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold tracking-normal text-brand">
          {status.planLabel ?? pkg.name}
        </span>
      )}
      {pkg.hasChat && (
        <span className="rounded-full bg-line-soft px-2.5 py-1 text-xs font-semibold tracking-normal text-ink-3">
          Live chat — coming soon
        </span>
      )}
    </span>
  );

  return <PageHeader title={title} subtitle={subtitle} action={action} />;
}
