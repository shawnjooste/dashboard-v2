"use client";

import { useActionState, useMemo, useState } from "react";
import { createBooking, type CreateBookingResult } from "@/lib/actions/bookings";
import { fmtRands, totalCents } from "@/lib/booking-helpers";
import type { BookingService } from "@/lib/views/bookings";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function BookSession({
  services,
  slots,
}: {
  services: BookingService[];
  slots: { iso: string; label: string }[];
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<CreateBookingResult | null, FormData>(
    async (prev, fd) => {
      const result = await createBooking(prev, fd);
      if (result.ok) window.location.href = result.url; // off to Paystack
      return result;
    },
    null,
  );
  const selected = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const days = useMemo(() => [...new Set(slots.map((s) => s.label.split(",")[0]))], [slots]);
  const [day, setDay] = useState<string>("");
  const daySlots = slots.filter((s) => s.label.startsWith(day ? `${day},` : ""));

  return (
    <form action={formAction} className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <select name="service_id" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={FIELD}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {fmtRands(totalCents(s.priceCents))} incl VAT
            </option>
          ))}
        </select>
        <select value={day} onChange={(e) => setDay(e.target.value)} className={FIELD}>
          <option value="">Pick a day…</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select name="slot_iso" required defaultValue="" className={FIELD} disabled={!day}>
          <option value="" disabled>
            Time…
          </option>
          {daySlots.map((s) => (
            <option key={s.iso} value={s.iso}>
              {s.label.split(", ")[1]}
            </option>
          ))}
        </select>
      </div>
      <input name="note" placeholder="What do you need help with? (optional)" className={`${FIELD} w-full`} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || !day}
          className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Starting payment…" : `Book & pay${selected ? ` ${fmtRands(totalCents(selected.priceCents))}` : ""}`}
        </button>
        <span className="text-xs text-muted">
          You&apos;ll pay securely on Paystack; the slot is confirmed once payment goes through.
        </span>
      </div>
      {state && !state.ok && <p className="text-xs text-brand">{state.error}</p>}
    </form>
  );
}
