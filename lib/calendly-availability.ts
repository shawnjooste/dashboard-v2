// Calendly as the SUPPORT availability oracle + booking writer. Tim's token —
// per-person convention (see lib/calendly.ts and the per-person-tokens note).
// EVERYTHING here is fail-soft: reads return null (caller falls back to the
// internal grid), writes return null/false (a paid booking must never depend
// on Calendly succeeding).
import "server-only";
import { chunkWindows, normalizeCalendlySlots } from "@/lib/calendly-helpers";

export const SUPPORT_HOST_TOKEN_ENV = "CALENDLY_API_TOKEN_TIM";
const MAX_WINDOW_DAYS = 7; // documented cap for event_type_available_times

function token(): string | null {
  return process.env[SUPPORT_HOST_TOKEN_ENV] ?? null;
}

async function cget(path: string): Promise<Record<string, unknown> | null> {
  const t = token();
  if (!t) {
    console.warn(`${SUPPORT_HOST_TOKEN_ENV} not set — Calendly availability disabled`);
    return null;
  }
  try {
    const res = await fetch(`https://api.calendly.com${path}`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Calendly GET ${path.split("?")[0]} failed:`, res.status);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("Calendly GET error:", e);
    return null;
  }
}

/** Bookable slots for an event type over the next `days` days (default 14),
 *  starting one hour from now. Null on any failure — caller must fall back. */
export async function getCalendlySlots(
  eventTypeUri: string,
  opts?: { days?: number },
): Promise<{ iso: string; label: string }[] | null> {
  const start = new Date(Date.now() + 3_600_000);
  const end = new Date(Date.now() + (opts?.days ?? 14) * 86_400_000);
  const windows = chunkWindows(start, end, MAX_WINDOW_DAYS);
  const collected: { start_time: string; status: string }[] = [];
  for (const w of windows) {
    const json = await cget(
      `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(w.start)}&end_time=${encodeURIComponent(w.end)}`,
    );
    if (!json) return null; // any window failing → whole read is unreliable
    collected.push(...((json.collection as { start_time: string; status: string }[]) ?? []));
  }
  return normalizeCalendlySlots(collected);
}

/** Books the meeting in Calendly (Scheduling API). Calendly invites the
 *  client AND Tim, and blocks his calendar. Null = failed (log only). */
export async function createCalendlyBooking(opts: {
  eventTypeUri: string;
  startIso: string;
  invitee: { name: string; email: string };
  note?: string | null;
}): Promise<{ eventUri: string | null } | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch("https://api.calendly.com/invitees", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: opts.eventTypeUri,
        start_time: opts.startIso,
        invitee: {
          name: opts.invitee.name,
          email: opts.invitee.email,
          timezone: "Africa/Johannesburg",
        },
      }),
    });
    if (!res.ok) {
      console.error("Calendly create invitee failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const body = (await res.json()) as { resource?: { event?: string | { uri?: string }; uri?: string } };
    const ev = body.resource?.event;
    const eventUri = typeof ev === "string" ? ev : (ev?.uri ?? null);
    return { eventUri };
  } catch (e) {
    console.error("Calendly create invitee error:", e);
    return null;
  }
}

/** Best-effort cancellation so Tim's calendar frees up. */
export async function cancelCalendlyEvent(eventUri: string, reason: string): Promise<boolean> {
  const t = token();
  if (!t) return false;
  const uuid = eventUri.split("/").pop();
  if (!uuid) return false;
  try {
    const res = await fetch(`https://api.calendly.com/scheduled_events/${uuid}/cancellation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) console.error("Calendly cancel failed:", res.status);
    return res.ok;
  } catch (e) {
    console.error("Calendly cancel error:", e);
    return false;
  }
}
