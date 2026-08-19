# Public status on the login page — design

**Date:** 2026-08-05
**Status:** Approved

## Problem

The status page told customers what was broken, but only once they were signed
in. During an outage that is precisely the wrong moment to demand a sign-in:
people arrive at the portal *because* something is wrong, and the login screen
tells them nothing.

The login page is also mostly dead space — a centred card on an empty canvas.

## Goal

An anonymous visitor to `portal.rocking.one/login` sees the current service
status without signing in, on a page that looks deliberate rather than empty.

## Decisions

These were settled during design and are not open in implementation:

1. **All global incidents are public.** No `is_public` flag. Anything scoped
   "Everyone" is world-readable the moment it is posted.
   - Consequence, accepted knowingly: the existing "Power outage in Westlake and
     surrounds" incident becomes public on deploy, and every future global
     incident publishes automatically with no extra step.
   - The residual risk is editorial, not technical: an incident title written
     mid-crisis ("Fibre down at GSR Law") would name a customer publicly. Nothing
     in the code prevents this. Scope such incidents to `clients`, which is never
     public.
2. **Client-scoped incidents are never public.** This is the hard boundary.
3. **The login page is the public status page.** No separate public URL.
4. **Left panel is flat near-black.** No gradient — coloured light behind a red
   incident dot competes with the one thing that must be noticed.
5. **When all is clear:** green "All systems operational" plus the last five
   resolved incidents. Note that `history` is currently empty in production, so
   the list renders nothing until an incident is resolved.

## Architecture

### 1. `lib/views/public-status.ts` (new)

```ts
export type PublicIncident = {
  id: string;
  title: string;
  type: string;
  startedAt: string;
  /** Newest update only — the panel is a summary, not a timeline. */
  latest: { body: string; createdAt: string } | null;
};

export type PublicStatus = {
  worst: string | null;            // null = all clear
  active: PublicIncident[];
  recent: { id: string; title: string; resolvedAt: string | null }[];
};

export async function getPublicStatus(): Promise<PublicStatus>;
```

**Reads with the service client, not RLS.** The query hard-codes
`.eq("scope", "global")`. The alternative — granting the `anon` role read access
and relying on RLS policy logic — makes correctness depend on a predicate that
could later be loosened by mistake. Here the query *is* the boundary: it cannot
select a `clients`-scoped row. It never queries `status_incident_clients`, so no
client name can reach the response even accidentally.

**Never throws.** The login page must render when the database is slow or
unreachable — an outage makes both likely, and a status panel that takes the
sign-in form down with it is worse than no panel. Every failure path returns
`{ worst: null, active: [], recent: [] }` and logs.

**Cached for 60 seconds** via `unstable_cache`. `/login` is the most-hit and
most-attacked route in the portal; an uncached read on every anonymous request is
a cheap amplification vector. Up to 60 seconds of staleness during an incident is
the accepted trade.

Shaping is delegated to a pure function so it can be tested without a database:

```ts
export function shapePublicStatus(
  incidents: RawIncident[],
  updates: RawUpdate[],
): PublicStatus;
```

- Drops any incident whose `scope !== "global"` — redundant with the query, and
  deliberately so: it is the assertion that fails if the query is ever loosened.
- Active incidents sorted by severity (`typeRank`) then newest first.
- Each active incident carries only its newest update.
- `recent` = resolved incidents, newest first, capped at 5.
- `worst` = `worstType()` over active types, reusing `lib/status-helpers.ts`.

### 2. `components/status/PublicStatusPanel.tsx` (new)

Presentational server component taking `PublicStatus`. Renders the dot
(`dotColour`), the label (`statusLabel`), then either the active incidents or the
all-clear plus recent list. Timestamps go through `fmtDateTime` from
`lib/time.ts` so they read in SAST, not UTC.

Closes with a muted line: "Sign in for updates affecting your company." — the
panel shows global incidents only, and a visitor should know their own
company's incidents exist behind the login.

### 3. `app/(auth)/login/page.tsx` (modified)

Becomes a two-column grid:

- **Left** (`1.35fr`, near-black `#141416`): Rocking logo, "THE PORTAL" eyebrow,
  then `PublicStatusPanel`.
- **Right** (`1fr`, card surface): the existing `LoginCard`, vertically centred.

Below the `md` breakpoint it collapses to one column with **the sign-in form
first and the status panel beneath**: someone on a phone is usually there to sign
in, and the panel remains visible by scrolling.

### 4. `app/(auth)/login/LoginCard.tsx` (modified)

**The form logic, server actions, and both `useActionState` flows are untouched.**
This is the authentication path; the change is strictly presentational. Only the
outer wrapper changes — the card border, shadow, brand top-stripe, logo and
"THE PORTAL" eyebrow are removed, because the page now provides that chrome.

## Testing

Vitest over `shapePublicStatus` (pure, no database):

- All-clear: no active incidents → `worst` is null.
- Severity: an outage and a degraded incident together → `worst` is "outage".
- Newest update only: an incident with three updates carries one, the newest.
- History cap: eight resolved incidents → `recent` has five, newest first.
- **Leak guard:** a `clients`-scoped incident passed directly is dropped.

Manual verification against the running app:

- Signed out, `/login` shows the Westlake outage with its newest update.
- Resolving it flips the panel to green.
- No client-scoped incident ever appears in the panel while signed out.
- The sign-in flow (email → code → portal) still completes.
- Mobile width stacks form-first.

## Files

- Create: `lib/views/public-status.ts`,
  `lib/views/__tests__/public-status.test.ts`,
  `components/status/PublicStatusPanel.tsx`
- Modify: `app/(auth)/login/page.tsx`, `app/(auth)/login/LoginCard.tsx`

No migration. No RLS change. No change to the authenticated status page.
