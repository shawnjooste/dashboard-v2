/** Pure billing logic for quote subscriptions — pro-rata, schedule, retries.
 *  No imports, no I/O: unit-tested with an injected "today". All date math is
 *  UTC; dates are "yyyy-mm-dd" strings. Money is integer cents throughout. */

export type InitialBreakdown = {
  onceOffCents: number;
  proRataCents: number;
  billableDays: number;
  /** Covered date range, null when the 3-day grace crosses month-end. */
  periodStart: string | null;
  periodEnd: string | null;
  /** First of the acceptance month — the month this charge is FOR. */
  billingPeriod: string;
  exVatCents: number;
  vatCents: number;
  totalCents: number;
};

const iso = (y: number, m: number, day: number): string =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * The initial checkout charge: once-off items + pro-rata for the partial
 * month. Billing starts 3 days after acceptance (installation grace) and runs
 * to month-end; if the grace crosses month-end the pro-rata is zero and the
 * first real charge is the full amount on the coming 1st. VAT is applied once,
 * on the combined ex-VAT total.
 */
export function computeInitialBreakdown(opts: {
  onceOffExCents: number;
  monthlyExCents: number;
  vatPercent: number;
  today: Date;
}): InitialBreakdown {
  const y = opts.today.getUTCFullYear();
  const m = opts.today.getUTCMonth();
  const dim = daysInMonth(y, m);
  const startDay = opts.today.getUTCDate() + 3;
  const billableDays = Math.max(0, dim - startDay + 1);
  const proRataCents = Math.round((opts.monthlyExCents * billableDays) / dim);
  const exVatCents = opts.onceOffExCents + proRataCents;
  const vatCents = Math.round((exVatCents * opts.vatPercent) / 100);
  return {
    onceOffCents: opts.onceOffExCents,
    proRataCents,
    billableDays,
    periodStart: billableDays > 0 ? iso(y, m, startDay) : null,
    periodEnd: billableDays > 0 ? iso(y, m, dim) : null,
    billingPeriod: iso(y, m, 1),
    exVatCents,
    vatCents,
    totalCents: exVatCents + vatCents,
  };
}

/** Paystack rejects a zero-amount transaction, and a reusable authorization
 *  only comes from a completed one — so a card-verification checkout charges
 *  the smallest amount Paystack accepts (R1) and refunds it immediately. */
export const VERIFICATION_AMOUNT_CENTS = 100;

/** "yyyy-mm-01" of the month containing the given date. */
export function firstOfThisMonth(d: Date): string {
  return iso(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** "yyyy-mm-01" of the month after the given date. */
export function firstOfNextMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return m === 11 ? iso(y + 1, 0, 1) : iso(y, m + 1, 1);
}

/** Deterministic Paystack reference: qs-<sub>-<yyyymm>-a<attempt>. Unique per
 *  attempt so retries can never collide, and traceable by eye in Paystack. */
export function chargeReference(subId: string, billingPeriod: string, attempt: number): string {
  return `qs-${subId}-${billingPeriod.slice(0, 7).replace("-", "")}-a${attempt}`;
}

export type ChargeRow = {
  billing_period: string;
  status: "pending" | "success" | "failed";
  attempt_number: number;
  created_at: string;
};

export type CronDecision =
  | { action: "charge"; attempt: number }
  | { action: "exhausted" }
  | { action: "wait" }
  | { action: "advance" };

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
export const RETRY_SPACING_DAYS = 2;

/**
 * What the daily cron should do for one subscription's due period, given the
 * charge rows already recorded for that period. Retries land on day 1/3/5
 * (each attempt ≥2 days after the last failure), then the schedule stops.
 */
export function decideCharge(periodCharges: ChargeRow[], today: Date): CronDecision {
  if (periodCharges.some((c) => c.status === "success")) return { action: "advance" };
  if (periodCharges.some((c) => c.status === "pending")) return { action: "wait" };
  const failed = periodCharges.filter((c) => c.status === "failed");
  if (failed.length === 0) return { action: "charge", attempt: 1 };
  const latest = failed.reduce((a, b) => (a.attempt_number > b.attempt_number ? a : b));
  if (latest.attempt_number >= MAX_ATTEMPTS) return { action: "exhausted" };
  const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysSince = Math.floor((utcMidnight(today) - utcMidnight(new Date(latest.created_at))) / DAY_MS);
  if (daysSince < RETRY_SPACING_DAYS) return { action: "wait" };
  return { action: "charge", attempt: latest.attempt_number + 1 };
}
