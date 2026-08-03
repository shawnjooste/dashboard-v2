import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createServiceClient } from "@/lib/supabase/service";
import { fmtMoney } from "@/lib/quotes/doc";
import { getSubscriptionForQuote } from "@/lib/views/subscriptions";
import { payArrears } from "@/lib/subscriptions/store";
import { PageHeader } from "@/components/ui";

/** Arrears recovery for a failed subscription: pay the outstanding month by
 *  card, which also captures a fresh authorization and resumes billing. */
export default async function PayArrearsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "quotes")) redirect("/");
  if (me.profile.role !== "client_manager") redirect("/");

  const service = createServiceClient();
  const { data: quote } = await service
    .from("quotes")
    .select("id, client_id, quote_number, title")
    .eq("id", id)
    .maybeSingle();
  if (!quote || quote.client_id !== me.profile.client_id) redirect("/quotes");

  const sub = await getSubscriptionForQuote(id);
  if (!sub || sub.status !== "failed" || !sub.failedPeriod) redirect(`/quotes/${id}`);

  const email = me.profile.email;
  async function pay() {
    "use server";
    const res = await payArrears({ quoteId: id, email });
    if (res.ok) redirect(res.url);
    redirect(`/quotes/${id}?pay_error=1`);
  }

  return (
    <div className="max-w-lg space-y-5">
      <PageHeader
        breadcrumb={
          <Link href={`/quotes/${id}`} className="underline underline-offset-2 hover:text-ink">
            {quote.quote_number}
          </Link>
        }
        title="Settle outstanding payment"
        subtitle={quote.title}
      />

      <div className="rounded-lg border border-line bg-card p-5">
        <p className="text-sm text-ink-2">
          The monthly payment for <strong>{sub.failedPeriod.slice(0, 7)}</strong> didn&apos;t go
          through. Paying it below also saves your new card for future monthly billing.
        </p>
        <dl className="mt-4 flex justify-between text-sm">
          <dt className="font-semibold text-ink">Outstanding (incl VAT)</dt>
          <dd className="font-semibold text-ink">{fmtMoney(sub.monthlyInclCents / 100)}</dd>
        </dl>
        <form action={pay} className="mt-4">
          <button className="w-full rounded-lg bg-good px-4 py-[10px] text-[14px] font-semibold text-white transition-colors hover:bg-[#116c33]">
            Pay {fmtMoney(sub.monthlyInclCents / 100)} by card
          </button>
        </form>
        <p className="mt-3 text-[12px] text-faint">
          If more than one month is outstanding, the remainder is collected automatically once this
          payment succeeds.
        </p>
      </div>
    </div>
  );
}
