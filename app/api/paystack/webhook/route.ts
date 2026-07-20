import { NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack-signature";
import { paystackSecret } from "@/lib/paystack";
import { confirmBooking } from "@/lib/booking-confirm";

/** Paystack webhook. The signature check is the authentication — anyone can
 *  POST here, but only Paystack can sign with our secret key. Always 200 on
 *  handled events (Paystack retries non-2xx). */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!verifyPaystackSignature(raw, signature, paystackSecret())) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string; amount?: number } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    const result = await confirmBooking(event.data.reference, Number(event.data.amount ?? 0));
    // not_found is fine (non-booking payments); underpaid is logged inside.
    return NextResponse.json({ handled: result });
  }
  return NextResponse.json({ ignored: event.event ?? "unknown" });
}
