import Link from "next/link";
import { getBooking } from "@/lib/views/bookings";
import { verifyTransaction } from "@/lib/paystack";
import { confirmBooking } from "@/lib/booking-confirm";
import { fmtRands } from "@/lib/booking-helpers";
import { Card, PageHeader, StatusPill } from "@/components/ui";

/** Booking status. If the client lands here from Paystack before the webhook
 *  arrives, the server-side verify fallback confirms the payment — the page
 *  never trusts the redirect itself. */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let booking = await getBooking(id);

  if (booking?.status === "pending_payment") {
    try {
      const check = await verifyTransaction(booking.reference);
      if (check.paid) {
        await confirmBooking(booking.reference, check.amountCents);
        booking = await getBooking(id);
      }
    } catch {
      // verify is best-effort; the webhook remains the primary path
    }
  }

  if (!booking) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumb={
            <Link href="/support" className="hover:text-ink">
              ← Back to support
            </Link>
          }
          title="Booking not found"
        />
      </div>
    );
  }

  const paid = booking.status === "paid" || booking.status === "completed";
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/support" className="hover:text-ink">
            ← Back to support
          </Link>
        }
        title={booking.serviceName}
        subtitle={booking.slotLabel}
      />
      <Card>
        <div className="space-y-3 px-4 py-4">
          <StatusPill
            tone={paid ? "good" : booking.status === "cancelled" ? "bad" : "warn"}
            label={
              booking.status === "pending_payment"
                ? "Awaiting payment"
                : booking.status[0].toUpperCase() + booking.status.slice(1)
            }
          />
          <p className="text-sm text-ink-2">
            {fmtRands(booking.amountCents + booking.vatCents)} incl VAT · ref {booking.reference}
          </p>
          {paid ? (
            <p className="text-sm text-muted">
              You&apos;re booked in — one of our engineers will be in touch at the booked time. Need to reschedule?
              Reply to your confirmation email or raise a ticket and we&apos;ll sort it out.
            </p>
          ) : booking.status === "pending_payment" ? (
            <p className="text-sm text-muted">
              This slot is held for 30 minutes while payment completes. If you closed the payment page, head back to
              Support and book again.
            </p>
          ) : (
            <p className="text-sm text-muted">This booking was cancelled. If that&apos;s unexpected, raise a ticket.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
