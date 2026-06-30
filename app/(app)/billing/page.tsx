import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getClientBilling } from "@/lib/views/billing";
import { BillingView } from "@/components/BillingView";
import { PageHeader } from "@/components/ui";

export default async function BillingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const billing = await getClientBilling(me.profile.client_id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      {billing.enabled ? (
        <BillingView billing={billing} today={today} />
      ) : (
        <p className="text-sm text-muted">Billing isn&apos;t set up for your account yet.</p>
      )}
    </div>
  );
}
