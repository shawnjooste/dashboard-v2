"use client";

import { useActionState, useMemo, useState } from "react";
import { createBooking, type CreateBookingResult } from "@/lib/actions/bookings";
import { fmtRands, totalCents } from "@/lib/booking-helpers";
import { slotDayKey } from "@/lib/calendly-helpers";
import type { BookingService } from "@/lib/views/bookings";

/** One line of plain English per service, keyed by the service key so it
 *  survives renames of the display name. */
const BLURB: Record<string, string> = {
  remote: "We connect to your machine and sort it out with you.",
  onsite: "One of our engineers comes to your office.",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday-first column index for a JS day number (0 = Sunday). */
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;

export function BookSession({
  services,
  slotsByService,
}: {
  services: BookingService[];
  slotsByService: Record<string, { iso: string; label: string }[]>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [slotIso, setSlotIso] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);
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

  /** dayKey → times, in order. */
  const byDay = useMemo(() => {
    const m = new Map<string, { iso: string; time: string }[]>();
    for (const s of slots) {
      const k = slotDayKey(s.iso);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ iso: s.iso, time: s.label.split(", ")[1] ?? s.label });
    }
    return m;
  }, [slots]);

  // The month shown: the first month containing availability, plus any paging.
  const baseMonth = useMemo(() => {
    const first = [...byDay.keys()].sort()[0];
    const d = first ? new Date(`${first}T00:00:00Z`) : new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }, [byDay]);

  const month = new Date(Date.UTC(baseMonth.getUTCFullYear(), baseMonth.getUTCMonth() + monthOffset, 1));
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = mondayIndex(month.getUTCDay());
  const monthPrefix = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const hasLaterMonth = [...byDay.keys()].some((k) => k.slice(0, 7) > monthPrefix);

  const times = dayKey ? (byDay.get(dayKey) ?? []) : [];

  const pickService = (id: string) => {
    setServiceId(id);
    setSlotIso("");
    setDayKey("");
    setMonthOffset(0);
  };

  const pickDay = (key: string) => {
    setDayKey(key);
    setSlotIso("");
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
                  {fmtRands(s.priceCents)} <span className="font-normal text-muted">ex VAT</span>
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {s.durationMinutes} min · {BLURB[s.key] ?? "Charged per session."}
              </p>
            </button>
          );
        })}
      </div>

      {byDay.size === 0 ? (
        <p className="text-[13px] text-muted">
          No times are open at the moment — raise a ticket and we&apos;ll sort something out.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
          {/* Month grid */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonthOffset((v) => v - 1)}
                disabled={monthOffset === 0}
                className="rounded px-2 py-0.5 text-sm text-muted hover:bg-line-soft hover:text-ink disabled:opacity-30"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="text-[13px] font-semibold text-ink">
                {MONTHS[month.getUTCMonth()]} {month.getUTCFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setMonthOffset((v) => v + 1)}
                disabled={!hasLaterMonth}
                className="rounded px-2 py-0.5 text-sm text-muted hover:bg-line-soft hover:text-ink disabled:opacity-30"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((d) => (
                <span key={d} className="py-1 text-[11px] font-medium text-faint">
                  {d[0]}
                </span>
              ))}
              {Array.from({ length: leading }).map((_, i) => (
                <span key={`b${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const key = `${monthPrefix}-${String(i + 1).padStart(2, "0")}`;
                const open = byDay.has(key);
                const on = key === dayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!open}
                    onClick={() => pickDay(key)}
                    aria-pressed={on}
                    className={`aspect-square rounded-full text-[13px] transition-colors ${
                      on
                        ? "bg-brand font-semibold text-white"
                        : open
                          ? "bg-brand-tint font-semibold text-brand hover:brightness-95"
                          : "text-faint"
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Times for the chosen day */}
          <div>
            {dayKey ? (
              <>
                <p className="mb-2 text-[13px] font-semibold text-ink">
                  {new Date(`${dayKey}T00:00:00Z`).toUTCString().slice(0, 11)}
                </p>
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {times.map((t) => {
                    const on = t.iso === slotIso;
                    return (
                      <button
                        key={t.iso}
                        type="button"
                        onClick={() => setSlotIso(t.iso)}
                        aria-pressed={on}
                        className={`rounded-md border px-3 py-1.5 text-[13px] transition-colors ${
                          on
                            ? "border-brand bg-brand text-white"
                            : "border-line text-ink-2 hover:border-brand hover:text-brand"
                        }`}
                      >
                        {t.time}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted">Pick a highlighted day to see available times.</p>
            )}
          </div>
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
            : `Book & pay${selected ? ` ${fmtRands(totalCents(selected.priceCents))} incl VAT` : ""}`}
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
