import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportStatus } from "@/lib/views/support-packages";
import { fmtMinutes } from "@/lib/support-package-helpers";
import { Card } from "@/components/ui";

/** The gate's face: what support the signed-in client's package gets them.
 *  Free → best-effort framing + upgrade nudge. Care/Partner → hours meter
 *  (managers only) + SLA copy. A plan label reframes the tier as part of a
 *  bundle ("Support is included in your Managed IT bundle"). */
export async function SupportTierBanner() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role === "rocking_staff" || !me.profile.client_id) return null;
  const status = await getSupportStatus(me.profile.client_id);
  const pkg = status.pkg;
  if (!pkg) return null;

  const isManager = me.profile.role === "client_manager";
  const heading = status.planLabel
    ? `Support is included in your ${status.planLabel}`
    : pkg.isDefault
      ? "Standard support"
      : `${pkg.name} support`;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5">
        <div>
          <div className="font-semibold text-ink">{heading}</div>
          <p className="text-[13px] text-muted">
            {pkg.isDefault
              ? "We respond as capacity allows. Need guaranteed response times or included hours? Ask us about Business Care."
              : pkg.slaHours
                ? `Priority handling — first response within ${pkg.slaHours} business hours.`
                : "Priority handling."}
          </p>
        </div>
        {!pkg.isDefault && pkg.includedMinutes > 0 && isManager && (
          <div className="ml-auto text-right">
            <div className="text-[13px] font-semibold text-ink">
              {fmtMinutes(status.usedMinutes)} of {fmtMinutes(pkg.includedMinutes)}
            </div>
            <div className="text-xs text-faint">support hours used this month</div>
          </div>
        )}
        {pkg.hasChat && (
          <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand">
            Live chat — coming soon
          </span>
        )}
      </div>
    </Card>
  );
}
