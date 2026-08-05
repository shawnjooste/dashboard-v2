# Pending-user status access — design

**Date:** 2026-08-05
**Status:** Approved

## Problem

A person who signs in but isn't yet linked to a company sits in a holding queue.
Today that queue is a dead end: `/pending` shows a card with a sign-out button and
nothing else. They can't see whether the portal — or their own connectivity — is
having a bad day, which is often exactly why they signed in.

Two secondary defects, both visible in the current code:

1. `app/(app)/pending/page.tsx` renders its own full-screen centred `<main>` while
   sitting *inside* the `(app)` layout's `AppShell`. The result is a holding card
   wrapped in a sidebar full of links the user cannot use.
2. The `(app)` layout has no status gate. Only `app/(app)/page.tsx` redirects to
   `/pending`. A pending user who types `/billing` or `/devices` gets a rendered
   page. It is empty — RLS returns nothing for a null `client_id` — so nothing
   leaks, but it should not render.

## Goal

An unassigned user can read the status page, subscribe to status emails, and
reach nothing else.

## What already works (no change needed)

- **RLS.** `can_see_incident()` resolves to global-only for a caller whose
  `current_client_id()` is null. An unassigned user sees global incidents and no
  client-scoped ones — the correct answer, already enforced in the database.
- **Email opt-in.** `status_subscriptions` is keyed on `profile_id` alone, with no
  client column. `resolveRecipients()` already passes a null-`clientId` subscriber
  through on a global incident and excludes them from a client-scoped one.
- **`/status` itself.** `app/(app)/status/page.tsx` admits any authenticated user;
  `StatusView` needs no client.

This is therefore a **UI and routing change only**: no migration, no RLS change,
no change to the status feature itself.

## Design

### 1. The gate — `lib/auth/pending-access.ts` (new)

A pure module, no imports beyond types, answering one question.

```ts
export type PendingMode = "full" | "pending" | "rejected";

export type PendingAccess = {
  mode: PendingMode;
  /** Path to redirect to, or null to proceed. */
  redirectTo: string | null;
};

export function resolvePendingAccess(input: {
  status: ProfileStatus;
  hasClient: boolean;
  pathname: string;
}): PendingAccess;
```

Rules, in order:

| Condition | Mode | Allowed paths | Anything else |
|---|---|---|---|
| `status === "rejected"` | `rejected` | `/pending` | → `/pending` |
| `status === "pending"` **or** `!hasClient` | `pending` | `/pending`, `/status` | → `/pending` |
| otherwise | `full` | all | — |

The `!hasClient` arm matters independently of `status`: an `active` profile with a
null `client_id` must still be held, not fall through to `full`.

Path matching is exact on `/pending` and `/status` (no prefix matching — there are
no child routes under either).

### 2. Where it runs — `app/(app)/layout.tsx`

Immediately after `getCurrentProfile()` and the staff redirect. When the mode is
not `full`, the layout short-circuits: it skips the client query, the `/welcome`
first-login name gate, feature access, and Crisp — all of which are client-scoped
and meaningless without a client.

It still computes `statusType`, so the top-bar dot is live, and still calls
`trackVisit`, so pending users appear in the admin Activity feed.

### 3. The shell — `components/AppShell.tsx` and `lib/nav.ts`

`AppShell` gains one optional prop, `pending?: boolean`. When set, the sidebar
renders `PENDING_NAV` (exported from `lib/nav.ts`) instead of `NAV[role]`, and
feature filtering is bypassed entirely.

```ts
export const PENDING_NAV: NavGroup[] = [
  { label: "", items: [{ label: "Status", href: "/status" }] },
];
```

A `rejected` user gets `pending` set but no nav items — the layout passes an empty
group list, and `AppShell`'s existing `.filter((g) => g.items.length > 0)` drops
the empty group, leaving a logo, the org label, and sign out.

The top-bar Status dot link stays as-is for `pending` mode. It is hidden for
`rejected`.

Everything else in the shell already behaves correctly: `orgLabel` falls back to
the email domain when `accountName` is null, which is what an unassigned user
should see.

### 4. The holding page — `app/(app)/pending/page.tsx`

Becomes an ordinary in-shell card:

- Drop the full-screen `min-h-screen` centring wrapper.
- Drop the sign-out button (the sidebar already has one).
- Keep both messages (pending vs rejected) unchanged in substance.
- In the pending case only, add a pointer to the status page: *"In the meantime,
  you can check service status for any current outages."* — linking to `/status`.

## Decisions

- **Rejected users get no status page.** Their access was declined; they should
  not retain a live portal surface. Approved explicitly.
- **Pending users may subscribe to status emails.** Someone waiting on access is
  precisely who benefits from knowing there is an outage, and it costs nothing.
- **`resolveLandingPath()` is unchanged.** `/` continues to send pending users to
  `/pending`; the new gate is a separate concern (per-path authorisation, not
  landing resolution) and lives in its own module.

## Testing

Vitest over `resolvePendingAccess` — the repo convention for pure logic:

- `active` + client → `full`, no redirect, on any path.
- `pending` + no client → `pending`; `/pending` and `/status` pass; `/billing`,
  `/devices`, `/` redirect to `/pending`.
- `active` + **no** client → `pending`, not `full`.
- `rejected` → `rejected`; `/pending` passes; `/status` redirects to `/pending`.

Manual verification against the running app: sign in as a pending account, confirm
the sidebar shows only Status, the status page loads with global incidents, a
direct hit on `/billing` bounces to `/pending`, and the subscribe toggle persists.

## Files

- Create: `lib/auth/pending-access.ts`, `lib/auth/__tests__/pending-access.test.ts`
- Modify: `lib/nav.ts`, `components/AppShell.tsx`, `app/(app)/layout.tsx`,
  `app/(app)/pending/page.tsx`
