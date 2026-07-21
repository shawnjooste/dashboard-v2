"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While a booking is awaiting payment, quietly re-render the page every few
 *  seconds. Each server render re-runs the verify fallback, so the moment
 *  Paystack settles (or the webhook lands) the page flips to Confirmed
 *  without the client touching anything. Stops with the component — it only
 *  renders in the pending state. */
export function PendingBookingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
