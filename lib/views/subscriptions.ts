// Read views for quote subscriptions. Service-role reads (the client quote
// page already gates by manager-of-this-client; admin pages gate by staff).
import { createServiceClient } from "@/lib/supabase/service";

export type SubView = {
  id: string;
  status: "pending_payment" | "active" | "cancelled" | "failed";
  monthlyInclCents: number;
  nextChargeDate: string | null;
  /** The billing period stuck in 'failed', for the arrears page. */
  failedPeriod: string | null;
};

export async function getSubscriptionForQuote(quoteId: string): Promise<SubView | null> {
  const service = createServiceClient();
  const { data: s } = await service
    .from("quote_subscriptions")
    .select("id, status, monthly_amount_cents, vat_cents, next_charge_date")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (!s) return null;
  let failedPeriod: string | null = null;
  if (s.status === "failed") {
    // The stuck period is wherever next_charge_date stopped advancing.
    failedPeriod = s.next_charge_date;
  }
  return {
    id: s.id,
    status: s.status as SubView["status"],
    monthlyInclCents: s.monthly_amount_cents + s.vat_cents,
    nextChargeDate: s.next_charge_date,
    failedPeriod,
  };
}

export type SubChargeRow = {
  period: string;
  attempt: number;
  chargeType: "initial" | "recurring";
  amountInclCents: number;
  status: "pending" | "success" | "failed";
  failureReason: string | null;
  chargedAt: string | null;
  createdAt: string;
};

export type SubAdminDetail = SubView & { charges: SubChargeRow[] };

/** Staff view: subscription + full charge history, newest first. */
export async function getSubscriptionAdminDetail(quoteId: string): Promise<SubAdminDetail | null> {
  const base = await getSubscriptionForQuote(quoteId);
  if (!base) return null;
  const service = createServiceClient();
  const { data: charges } = await service
    .from("quote_subscription_charges")
    .select("billing_period, attempt_number, charge_type, amount_cents, vat_cents, status, failure_reason, charged_at, created_at")
    .eq("subscription_id", base.id)
    .order("created_at", { ascending: false });
  return {
    ...base,
    charges: (charges ?? []).map((c) => ({
      period: c.billing_period,
      attempt: c.attempt_number,
      chargeType: c.charge_type as "initial" | "recurring",
      amountInclCents: c.amount_cents + c.vat_cents,
      status: c.status as "pending" | "success" | "failed",
      failureReason: c.failure_reason,
      chargedAt: c.charged_at,
      createdAt: c.created_at,
    })),
  };
}
