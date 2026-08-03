/** Server-only Paystack REST client. ZAR amounts are in CENTS everywhere. */

const BASE = "https://api.paystack.co";

export function paystackSecret(): string {
  const key =
    process.env.PAYSTACK_USE_TEST === "1"
      ? process.env.PAYSTACK_TEST_SECRET_KEY
      : process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Paystack secret key is not configured");
  return key;
}

async function ps(path: string, init?: RequestInit): Promise<{ status: boolean; message: string; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json.status !== true) throw new Error(`Paystack ${path} failed: ${json.message ?? res.status}`);
  return json;
}

/** Start a hosted checkout; returns the URL to redirect the client to.
 *  `channels: ["card"]` forces card-only — required when the payment must
 *  yield a REUSABLE authorization (recurring quote checkouts); EFT and other
 *  channels produce authorizations that cannot be charged again. */
export async function initializeTransaction(opts: {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
  channels?: string[];
}): Promise<string> {
  const json = await ps("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountCents,
      currency: "ZAR",
      reference: opts.reference,
      callback_url: opts.callbackUrl,
      ...(opts.channels?.length ? { channels: opts.channels } : {}),
    }),
  });
  const url = json.data.authorization_url;
  if (typeof url !== "string") throw new Error("Paystack initialize returned no authorization_url");
  return url;
}

/** Server-side fallback check (the webhook is the primary truth). Also
 *  surfaces the card authorization so subscription checkouts can store it. */
export async function verifyTransaction(reference: string): Promise<{
  paid: boolean;
  amountCents: number;
  authorizationCode: string | null;
  customerCode: string | null;
}> {
  const json = await ps(`/transaction/verify/${encodeURIComponent(reference)}`);
  const auth = json.data.authorization as { authorization_code?: string; reusable?: boolean } | undefined;
  const customer = json.data.customer as { customer_code?: string } | undefined;
  return {
    paid: json.data.status === "success",
    amountCents: Number(json.data.amount ?? 0),
    authorizationCode: auth?.authorization_code ?? null,
    customerCode: customer?.customer_code ?? null,
  };
}

/** Charge a stored (reusable) card authorization — the recurring engine.
 *  Synchronous result. A DECLINE is HTTP 200 with data.status !== "success",
 *  so it is returned, not thrown; only transport/API errors throw (callers
 *  leave the attempt pending and retry on the next cron run). */
export async function chargeAuthorization(opts: {
  email: string;
  amountCents: number;
  reference: string;
  authorizationCode: string;
}): Promise<{ success: boolean; failureReason: string | null }> {
  const json = await ps("/transaction/charge_authorization", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountCents,
      currency: "ZAR",
      reference: opts.reference,
      authorization_code: opts.authorizationCode,
    }),
  });
  const ok = json.data.status === "success";
  const reason = (json.data.gateway_response ?? json.data.status) as string | undefined;
  return { success: ok, failureReason: ok ? null : (reason ?? "declined") };
}
