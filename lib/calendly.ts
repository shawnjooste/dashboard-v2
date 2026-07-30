// Calendly single-use scheduling links, for "book a call to discuss this quote".
//
// Calendly hard-caps these at ONE booking (POST /scheduling_links documents
// max_event_count as "Allowed value: 1"), so a link cannot be shared across
// recipients — the first person to book consumes it and the next sees
// "Someone has already used this link to book a meeting". We deliberately mint
// one link per QUOTE rather than per recipient: a quote warrants one
// conversation, whoever books it.
//
// Unused links expire after 90 days, so callers should treat a stored link
// older than that as spent (see LINK_TTL_DAYS).
import "server-only";

// Tokens are per-person (CALENDLY_API_TOKEN_<NAME>) because a booking link is
// minted against that person's Calendly account and lands in their diary.
// Quote calls are with Shawn, so quotes use his. Adding another host means
// adding their token under the same convention, not renaming this one.
export const QUOTE_HOST_TOKEN_ENV = "CALENDLY_API_TOKEN_SHAWN";

/** Which meeting a quote call books into — Shawn's TeamsCall, 30 min. */
export const QUOTE_EVENT_TYPE_URI =
  "https://api.calendly.com/event_types/81ecffd2-21f7-414f-a480-9da2ad101ddc";

/** Calendly expires unused single-use links after 90 days. */
export const LINK_TTL_DAYS = 90;

/** True when a stored link is old enough that Calendly may have expired it. */
export function isBookingLinkStale(createdAt: string | null): boolean {
  if (!createdAt) return true;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs > LINK_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Mints a single-use booking link. Returns null rather than throwing when
 * Calendly is unreachable or unconfigured — a quote must still go out if the
 * booking link can't be created.
 */
export async function createSingleUseBookingLink(
  eventTypeUri: string = QUOTE_EVENT_TYPE_URI,
): Promise<string | null> {
  const token = process.env[QUOTE_HOST_TOKEN_ENV];
  if (!token) {
    console.warn(`${QUOTE_HOST_TOKEN_ENV} not set — skipping quote booking link`);
    return null;
  }
  try {
    const res = await fetch("https://api.calendly.com/scheduling_links", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        max_event_count: 1, // Calendly allows only 1
        owner: eventTypeUri,
        owner_type: "EventType",
      }),
    });
    if (!res.ok) {
      console.error("Calendly scheduling_links failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const body = (await res.json()) as { resource?: { booking_url?: string } };
    return body.resource?.booking_url ?? null;
  } catch (e) {
    console.error("Calendly scheduling_links error:", e);
    return null;
  }
}
