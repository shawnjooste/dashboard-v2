# Role-Adaptive Sidebar — Design

**Date:** 2026-06-10
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

The app currently uses a top-bar-only shell. More sections are coming at every user level
(billing, support, data sources, role management), so the primary navigation moves to a left
sidebar for **all three roles**, with live items only — new items are added as features ship.

## Menu (single source of truth)

Role → items, defined in `lib/nav.ts`:

- **rocking_staff:** Overview `/admin` · Clients `/admin/clients` · Approvals `/admin/pending`
- **client_manager:** Devices `/` · Team `/team`
- **client_member:** My Machine `/`

Adding a future item is one line in this config. No disabled/"coming soon" entries.

## Layout

`components/AppShell.tsx` becomes a two-column layout:

- **Left sidebar (~220px, full height):** Rocking logo at top → nav items (icon-less text links,
  active item highlighted) → spacer → user email + Sign out button pinned at the bottom.
- **Content area:** keeps the existing max-width + padding.
- **Small screens (< md):** the sidebar collapses to a slim horizontal bar across the top
  (logo + links + sign out); no hamburger/drawer machinery.
- The old top bar is removed entirely; the role pill is no longer needed (the menu itself
  communicates the surface).

`AppShell` props change from `{ email, roleLabel }` to `{ email, role }` (a `UserRole`), and it
resolves nav items from `lib/nav.ts`. Both layouts already pass profile data; they pass `role`
instead of a label.

## Components

- `lib/nav.ts` — `NAV: Record<UserRole, { label: string; href: string }[]>` (pure data).
- `components/Sidebar.tsx` — `"use client"` component: receives `items`, uses `usePathname()` for
  active-state (exact match for `/`, prefix match otherwise so `/admin/clients/[id]` keeps
  "Clients" active; `/admin` uses exact match so it doesn't stay lit on `/admin/clients`).
  Renders the nav list only — logo and user block stay in `AppShell` (server) so the client
  bundle stays tiny.
- `components/AppShell.tsx` — server component arranging sidebar column (logo, `<Sidebar>`,
  user block) + content column, with the responsive collapse.

## New pages

1. **`app/(admin)/admin/clients/page.tsx`** — all clients alphabetically (staff RLS sees all),
   joined with device health where present: device count + needs-attention count, linking to the
   existing `/admin/clients/[id]` drill-in. Clients without devices render with "no devices yet".
   Data: `clients` table + `getVisibleDeviceHealth()` grouped by client (reuses existing fns).
2. **`app/(app)/team/page.tsx`** — manager-only (members redirected to `/`): lists their client's
   users from `profiles` (email, role, status) — RLS (`profiles_manager_select`) already permits
   this read. Read-only for now; role-management actions are a later slice.

## Unchanged

Auth gates, RLS, page content, routes. The cockpit's inline "Pending approvals" link can stay or
go — remove it, since Approvals is now in the sidebar.

## Error handling

- `/team` for a non-manager: redirect to `/` (members) — staff never see the client surface.
- Clients list with zero device data: renders names with em-dash counts (no crash on empty joins).

## Testing

Presentational + thin fetches over already-tested functions: verify via `npm run build`,
`npx tsc --noEmit`, `npm run lint`, existing `npm test`, plus a live walkthrough on all three
roles' nav (admin live; manager/member when such users exist).

## Files

- Create: `lib/nav.ts`, `components/Sidebar.tsx`, `app/(admin)/admin/clients/page.tsx`,
  `app/(app)/team/page.tsx`
- Modify: `components/AppShell.tsx`, `app/(app)/layout.tsx`, `app/(admin)/layout.tsx`,
  `app/(admin)/admin/page.tsx` (drop inline approvals link)
