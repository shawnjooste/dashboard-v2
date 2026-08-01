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
  embedded = false,
  ticketNumber,
  covered = false,
  compact = false,
}: {
  services: BookingService[];
  slotsByService: Record<string, { iso: string; label: string }[]>;
  /** Embedded: render inside a parent form (no <form>, no submit of our own),
   *  with a free-vs-session choice up front. Used by the "get help" flow. */
  embedded?: boolean;
  /** The ticket this session belongs to — every session is anchored to one. */
  ticketNumber?: number;
  /** Client is on a plan that covers sessions: no payment step, no prices. */
  covered?: boolean;
  /** Narrow container (e.g. a sidebar): stack everything in one column
   *  instead of sitting the times beside the calendar. */
  compact?: boolean;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [slotIso, setSlotIso] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);
  const [mode, setMode] = useState<"reply" | "session">("reply");
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

  const picker = (
    <>
      <input type="hidden" name="service_id" value={serviceId} />
      <input type="hidden" name="slot_iso" value={slotIso} />
      {ticketNumber != null && <input type="hidden" name="ticket_number" value={ticketNumber} />}

      <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
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
                  {covered ? (
                    <span className="font-normal text-muted">included</span>
                  ) : (
                    <>
                      {fmtRands(s.priceCents)} <span className="font-normal text-muted">ex VAT</span>
                    </>
                  )}
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
        <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-[260px_1fr]"}`}>
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

      {!embedded && (
        <input
          name="note"
          placeholder="Anything else we should know? (optional)"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
        />
      )}
    </>
  );

  // Embedded: the parent form owns submission. We contribute the free-vs-session
  // choice, and the picker only once a session is actually wanted.
  if (embedded) {
    return (
      <div className="space-y-4">
        <input type="hidden" name="mode" value={mode} />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">How would you like this handled?</legend>
          {(
            [
              ["reply", "We'll reply on the ticket", "Included — no charge."],
              ["session", "Book a session", "Remote or onsite, at a time you pick."],
            ] as const
          ).map(([value, title, sub]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                mode === value ? "border-brand bg-brand-tint" : "border-line hover:bg-canvas"
              }`}
            >
              <input
                type="radio"
                name="handling"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">{title}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === "session" && (
          <>
            {picker}
            <p className="text-xs text-muted">
              {covered
                ? "Covered by your support plan — no payment needed."
                : slotIso && selected
                  ? `You'll pay ${fmtRands(totalCents(selected.priceCents))} incl VAT securely on Paystack after this step.`
                  : "Pick a time — you'll pay on the next step."}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 px-4 py-3.5">
      {picker}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || !slotIso}
          className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending
            ? covered
              ? "Booking…"
              : "Starting payment…"
            : covered
              ? "Book this session"
              : `Book & pay${selected ? ` ${fmtRands(totalCents(selected.priceCents))} incl VAT` : ""}`}
        </button>
        <span className="text-xs text-muted">
          {!slotIso
            ? "Pick a time to continue."
            : covered
              ? "Covered by your support plan — we'll confirm it straight away."
              : "You'll pay securely on Paystack; the slot is confirmed once payment goes through."}
        </span>
      </div>

      {state && !state.ok && <p className="text-xs text-brand">{state.error}</p>}
    </form>
  );
}
