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

/** Start a hosted checkout; returns the URL to redirect the client to. */
export async function initializeTransaction(opts: {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
}): Promise<string> {
  const json = await ps("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountCents,
      currency: "ZAR",
      reference: opts.reference,
      callback_url: opts.callbackUrl,
    }),
  });
  const url = json.data.authorization_url;
  if (typeof url !== "string") throw new Error("Paystack initialize returned no authorization_url");
  return url;
}

/** Server-side fallback check (the webhook is the primary truth). */
export async function verifyTransaction(reference: string): Promise<{ paid: boolean; amountCents: number }> {
  const json = await ps(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { paid: json.data.status === "success", amountCents: Number(json.data.amount ?? 0) };
}
