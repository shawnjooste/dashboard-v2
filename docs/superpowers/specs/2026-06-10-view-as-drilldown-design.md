# View-As Drill-Down (Device Detail) — Design

**Date:** 2026-06-10
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Support need: when a client reports an issue with a machine, Rocking staff want to drill from
the admin cockpit down to a single device and see what's going on — including the plain-language
"My Machine" card the device's user would see.

This is **Approach A (contextual drill-down)**, chosen over true session impersonation. It is the
admin's own (RLS: staff-sees-all) view, scoped in the UI to one device — *not* an impersonated
session. It therefore covers the Datto device data only and does not auto-extend to future
client-facing features. (True impersonation was considered and deferred; see the conversation.)

## Goal

From the admin cockpit: client card → client fleet (already built) → **click a machine → a device
detail page** showing the member's "My Machine" card plus diagnostic detail.

## Non-Goals

- Session impersonation / "act as user" (deferred).
- Any non-Datto surface (billing, tickets — they don't exist yet).
- Auth, RLS, or schema changes.

## Design

### 1. Device detail page — `app/(admin)/admin/devices/[id]/page.tsx`

A staff-only (inherits the `(admin)` layout gate) server component, rendered at
`/admin/devices/[id]`. It calls `getDeviceDetail(id)` (already built in `lib/views/devices.ts`,
returns `{ health, drives, alerts, trend }` or `null`). On `null` → a "device not found" message.

Layout, top to bottom:
- A "← back" link to the device's client fleet (`/admin/clients/[clientId]`), using
  `health.clientId`.
- **The member's view:** the existing `DeviceHealthCard` fed `health` — the exact plain-language
  card the device's user sees ("Your machine is healthy" / "needs a reboot").
- **Drives** — a small table from `detail.drives` (drive, size GB, used %), with used % ≥90 in red.
- **Recent alerts** — a list from `detail.alerts` (triggered-at, message, priority, resolved),
  most-recent first (already limited to 20 in the fetch). Empty-state when none.
- **Trend** — a `Sparkline` (already built) of `detail.trend` patch % (and/or max disk %) over
  snapshot dates; it already degrades to "not enough history" with a single data point.

### 2. Clickable fleet rows — shared `DeviceTable`

Add an optional prop `rowHref?: (deviceId: string) => string` to `components/DeviceTable.tsx`.
When provided, each row becomes a link (wrap the row / make the device cell a `<Link>`) to
`rowHref(device.id)`. When absent (manager/member surfaces), rows render exactly as today (no link).

Wire `rowHref={(id) => \`/admin/devices/${id}\`}` into:
- the admin cockpit "needs attention" table (`app/(admin)/admin/page.tsx`)
- the client drill-in table (`app/(admin)/admin/clients/[id]/page.tsx`)

The manager Network Overview and member views pass no `rowHref` — unchanged.

### 3. Reuse

`DeviceHealthCard`, `Sparkline`, and `getDeviceDetail` already exist from Plan 4. The only new code
is the device detail page and the `rowHref` prop (+ two call sites).

## Error Handling

- `getDeviceDetail` returns `null` when the device isn't visible to the caller (RLS) or doesn't
  exist → the page renders a "device not found" message with the back link. Staff see all, so in
  practice this is the bad-id case.

## Testing

- The page and table changes are presentational over already-tested data fns; verify via
  `npm run build` + `npx tsc --noEmit` + `npm run lint` and a live walkthrough (admin → client →
  device). No new pure logic to unit-test (the `getDeviceDetail` aggregation reuses the
  already-tested `deviceHealth`).

## Files

- Create: `app/(admin)/admin/devices/[id]/page.tsx`
- Modify: `components/DeviceTable.tsx` (add `rowHref` prop), `app/(admin)/admin/page.tsx`,
  `app/(admin)/admin/clients/[id]/page.tsx` (pass `rowHref`)
