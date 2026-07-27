import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAllBookings, type Booking } from "@/lib/views/bookings";
import { markBookingCompleted, cancelBooking } from "@/lib/actions/bookings";
import { fmtRands, groupBookings } from "@/lib/booking-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

function Row({ b, actions }: { b: Booking; actions: boolean }) {
  const complete = markBookingCompleted.bind(null, b.id);
  const cancel = cancelBooking.bind(null, b.id);
  return (
    <li className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
      <span className="w-28 shrink-0 text-sm font-medium text-ink">{b.slotLabel}</span>
      <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
        {b.status === "pending_payment" ? "pending" : b.status}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          <span className="font-medium">{b.clientName ?? "—"}</span> · {b.serviceName}
        </p>
        <p className="truncate text-xs text-faint">
          {fmtRands(b.amountCents + b.vatCents)} incl
          {b.freescoutNumber ? ` · ticket #${b.freescoutNumber}` : ""}
          {b.note ? ` · ${b.note}` : ""}
        </p>
      </div>
      {actions && b.status === "paid" && (
        <>
          <form action={complete}>
            <button className="text-xs font-semibold text-good">Mark completed</button>
          </form>
          <form action={cancel}>
            <button
              className="text-xs text-faint hover:text-brand"
              title="Cancel (refunds are manual — Paystack dashboard)"
            >
              Cancel
            </button>
          </form>
        </>
      )}
    </li>
  );
}

export default async function AdminBookingsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const all = await getAllBookings(100);
  const { upcoming, needsAttention, recent } = groupBookings(all, new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        subtitle="Paid support sessions across all clients — what's coming up, what needs closing out, and recent history."
      />

      <Card>
        <CardHeader title="Upcoming" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">Nothing booked ahead.</p>
        ) : (
          <ul>
            {upcoming.map((b) => (
              <Row key={b.id} b={b} actions />
            ))}
          </ul>
        )}
      </Card>

      {needsAttention.length > 0 && (
        <Card>
          <CardHeader title="Needs attention" count={needsAttention.length} />
          <p className="border-b border-line-soft px-4 pb-3 pt-3.5 text-[13px] text-muted">
            Paid sessions whose slot has passed but were never marked completed.
          </p>
          <ul>
            {needsAttention.map((b) => (
              <Row key={b.id} b={b} actions />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Recent" count={recent.length} />
        {recent.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No completed, cancelled or pending bookings yet.</p>
        ) : (
          <ul>
            {recent.map((b) => (
              <Row key={b.id} b={b} actions={false} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
