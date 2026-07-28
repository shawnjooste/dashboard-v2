import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getCompanyDetails, getCompanyDetailChanges } from "@/lib/views/company-details";
import { EDITABLE_FIELDS, FIELD_LABELS, formatValue, type CompanyDetails } from "@/lib/company-details-helpers";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { CompanyDetailsForm } from "./CompanyDetailsForm";

export default async function CompanyDetailsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "billing")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const [details, changes] = await Promise.all([
    getCompanyDetails(me.profile.client_id),
    getCompanyDetailChanges(me.profile.client_id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      <BillingTabs active="company" />

      <Card>
        <CardHeader title="Company details" />
        <div className="space-y-4 p-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map((f) => (
              <div key={f}>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{FIELD_LABELS[f]}</dt>
                <dd className="whitespace-pre-line text-sm text-ink">{formatValue(f, details[f as keyof CompanyDetails])}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-muted">
            Something wrong? Correct it here and we&rsquo;ll update our records. Changes are logged below and sent to our accounts team.
          </p>
          <CompanyDetailsForm details={details} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Activity" count={changes.length} />
        {changes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {changes.map((c) => (
              <li key={c.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">{c.actor ?? "Someone"}</span>{" "}
                <span className="text-ink-2">
                  {c.oldValue === null ? (
                    <>set {c.label} to <span className="font-medium text-ink">{c.newValue}</span></>
                  ) : c.newValue === null ? (
                    <>cleared {c.label} (was <span className="font-medium text-ink">{c.oldValue}</span>)</>
                  ) : (
                    <>
                      changed {c.label} from <span className="font-medium text-ink">{c.oldValue}</span> to{" "}
                      <span className="font-medium text-ink">{c.newValue}</span>
                    </>
                  )}
                </span>
                <span className="ml-1 text-muted">
                  — {new Date(c.at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
