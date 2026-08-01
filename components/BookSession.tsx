"use client";

import { useActionState, useMemo, useState } from "react";
import { createBooking, type CreateBookingResult } from "@/lib/actions/bookings";
import { fmtRands, totalCents } from "@/lib/booking-helpers";
import type { BookingService } from "@/lib/views/bookings";

/** One line of plain English per service, keyed by the service key so it
 *  survives renames of the display name. */
const BLURB: Record<string, string> = {
  remote: "We connect to your machine and sort it out with you.",
  onsite: "One of our engineers comes to your office.",
};

const DAYS_SHOWN = 3; // more are a click away — keeps the card scannable

export function BookSession({
  services,
  slotsByService,
}: {
  services: BookingService[];
  slotsByService: Record<string, { iso: string; label: string }[]>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [slotIso, setSlotIso] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState<CreateBookingResult | null, FormData>(
    async (prev, fd) => {
      const result = await createBooking(prev, fd);
      if (result.ok) window.location.href = result.url; // off to Paystack
      return result;
    },
    null,
  );

  const selected = services.find((s) => s.id === serviceId);
  const slots = slotsByService[serviceId] ?? [];

  // "Mon 3 Aug, 08:00" → { day: "Mon 3 Aug", time: "08:00" }, grouped in order.
  const byDay = useMemo(() => {
    const groups = new Map<string, { iso: string; time: string }[]>();
    for (const s of slots) {
      const [day, time] = s.label.split(", ");
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push({ iso: s.iso, time: time ?? s.label });
    }
    return [...groups.entries()];
  }, [slots]);

  const visibleDays = expanded ? byDay : byDay.slice(0, DAYS_SHOWN);

  const pickService = (id: string) => {
    setServiceId(id);
    setSlotIso(""); // availability differs per service
  };

  return (
    <form action={formAction} className="space-y-4 px-4 py-3.5">
      <input type="hidden" name="service_id" value={serviceId} />
      <input type="hidden" name="slot_iso" value={slotIso} />

      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => {
          const on = s.id === serviceId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => pickService(s.id)}
              aria-pressed={on}
              className={`rounded-lg border p-3 text-left transition-colors ${
                on ? "border-brand bg-brand-tint" : "border-line hover:bg-canvas"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{s.name}</span>
                <span className={`text-[13px] font-semibold ${on ? "text-brand" : "text-ink-2"}`}>
                  {fmtRands(totalCents(s.priceCents))}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{BLURB[s.key] ?? "One hour, incl VAT."}</p>
            </button>
          );
        })}
      </div>

      {byDay.length === 0 ? (
        <p className="text-[13px] text-muted">
          No times are open at the moment — raise a ticket and we&apos;ll sort something out.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleDays.map(([day, times]) => (
            <div key={day} className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-xs font-medium text-ink-3">{day}</span>
              {times.map((t) => {
                const on = t.iso === slotIso;
                return (
                  <button
                    key={t.iso}
                    type="button"
                    onClick={() => setSlotIso(t.iso)}
                    aria-pressed={on}
                    className={`rounded-md border px-2.5 py-1 text-[13px] transition-colors ${
                      on
                        ? "border-brand bg-brand text-white"
                        : "border-line text-ink-2 hover:border-faint hover:bg-canvas"
                    }`}
                  >
                    {t.time}
                  </button>
                );
              })}
            </div>
          ))}
          {byDay.length > DAYS_SHOWN && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-semibold text-muted hover:text-ink"
            >
              {expanded ? "Show fewer days" : `More times (${byDay.length - DAYS_SHOWN} more days)`}
            </button>
          )}
        </div>
      )}

      <input
        name="note"
        placeholder="What do you need help with? (optional)"
        className="w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || !slotIso}
          className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending
            ? "Starting payment…"
            : `Book & pay${selected ? ` ${fmtRands(totalCents(selected.priceCents))}` : ""}`}
        </button>
        <span className="text-xs text-muted">
          {slotIso
            ? "You'll pay securely on Paystack; the slot is confirmed once payment goes through."
            : "Pick a time to continue."}
        </span>
      </div>

      {state && !state.ok && <p className="text-xs text-brand">{state.error}</p>}
    </form>
  );
}
