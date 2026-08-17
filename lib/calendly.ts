// Calendly single-use scheduling links, for "book a call to discuss this quote".
//
// The Calendly-specific mechanics live in lib/quotes/booking-link.ts, which
// is marker-free so a plain Node script can import it directly. This module
// stays server-only and re-exports for existing Next.js callers.
import "server-only";

export {
  isBookingLinkStale,
  createSingleUseBookingLink,
  LINK_TTL_DAYS,
  QUOTE_HOST_TOKEN_ENV,
  QUOTE_EVENT_TYPE_URI,
} from "./quotes/booking-link.ts";
