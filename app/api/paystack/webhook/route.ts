import { NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack-signature";
import { paystackSecret } from "@/lib/paystack";
import { confirmBooking } from "@/lib/booking-confirm";
import { confirmSubscriptionCharge } from "@/lib/subscriptions/store";

/** Paystack webhook. The signature check is the authentication — anyone can
 *  POST here, but only Paystack can sign with our secret key. Always 200 on
 *  handled events (Paystack retries non-2xx). */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!verifyPaystackSignature(raw, signature, paystackSecret())) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      authorization?: { authorization_code?: string };
      customer?: { customer_code?: string };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    const ref = event.data.reference;
    const amount = Number(event.data.amount ?? 0);
    // qs- references are quote-subscription charges; everything else is a
    // support booking. Same idempotent-confirm discipline on both paths.
    const result = ref.startsWith("qs-")
      ? await confirmSubscriptionCharge(ref, amount, {
          authorizationCode: event.data.authorization?.authorization_code ?? null,
          customerCode: event.data.customer?.customer_code ?? null,
        })
      : await confirmBooking(ref, amount);
    // not_found is fine (unrelated payments); underpaid is logged inside.
    return NextResponse.json({ handled: result });
  }
  return NextResponse.json({ ignored: event.event ?? "unknown" });
}
