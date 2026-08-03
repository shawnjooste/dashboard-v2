/** Timestamp formatting for the portal — no server imports (vitest-safe).
 *
 *  Postgres hands us UTC and the servers run UTC, but everyone reading this
 *  portal is in South Africa. Slicing an ISO string (`"…".replace("T"," ")`)
 *  renders UTC as if it were local time, which showed outages two hours in
 *  the past. Everything here formats in SAST explicitly, so server-rendered
 *  output is deterministic — no hydration mismatch, no drift with DST
 *  elsewhere. */

export const SA_TZ = "Africa/Johannesburg";

function parts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const got = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: got.year,
    month: got.month,
    day: got.day,
    hour: got.hour,
    minute: got.minute,
  };
}

/** "2026-08-03 06:40" in SAST. */
export function fmtDateTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : fallback;
}

/** "2026-08-03" in SAST. */
export function fmtDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : fallback;
}

/** "06:40" in SAST. */
export function fmtTime(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const p = parts(iso);
  return p ? `${p.hour}:${p.minute}` : fallback;
}
