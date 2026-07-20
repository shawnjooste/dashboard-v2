# Connectivity — Slice 1 Design

**Date:** 2026-07-20
**Status:** Approved in conversation (Shawn).

## Purpose

Connectivity customers are Rocking's largest client group, and the portal has
nothing for them: the lines they buy (fibre / fixed wireless / LTE) have no
system of record, and "is my internet down?" has no answer. Slice 1 gives them
a Connectivity section: their lines, live status, and a fast lane to report
problems.

## Decisions

- **The portal becomes the source of record for lines.** No system holds this
  today (sheets/heads). Staff enter and maintain services manually.
- **Live status via a LibreNMS proxy** (chosen over frequent-pull/nightly):
  fetched at page view like FreeScout tickets. Requires `LIBRENMS_URL` +
  `LIBRENMS_API_KEY` (read-only token) in `.env.local`/Vercel env. If LibreNMS
  turns out to be unreachable from Vercel, the fallback is a frequent pull with
  the same UI — the proxy module is the only piece that changes.
- **Graceful degradation:** short timeout; LibreNMS unreachable → "status
  unavailable", never a broken page. Unmapped lines render without a pulse.
- Full vision (all four answers: lines + monitoring + commercial wrapper +
  support gateway) is sliced: **Slice 2** = outage history, availability %,
  bandwidth graphs (needs snapshotting). **Slice 3** = contract/commercial
  depth, "upgrade my line" → RFQ/quote pipeline, known-outage banners.

## Data model

Migration (next free number — CHECK for parallel-session collisions first;
0045 was taken once already): `connectivity_services`

- `id uuid pk`, `client_id uuid not null references clients on delete cascade`
- `label text not null` — e.g. "Main office fibre"
- `kind text not null default 'fibre' check in ('fibre','wireless','lte','other')`
- `provider text` — e.g. "Openserve", "Rocking Wireless"
- `download_mbps int`, `upload_mbps int`
- `librenms_device_id int` — nullable; the monitoring link
- `notes text`, `is_active boolean not null default true`
- `created_at`, `updated_at`
- RLS: staff all (`is_rocking_staff()`); client users **select** own
  (`client_id = current_client_id()` and `is_active`) — members included
  (page access is still feature-gated to managers by default; RLS read for
  members is harmless and future-proofs a member view).

## LibreNMS proxy — `lib/librenms.ts`

Server-only. `getLineStatuses(deviceIds: number[]): Promise<Map<number, LineStatus>>`
where `LineStatus = { up: boolean | null; downSince: string | null }`.
- GET `{LIBRENMS_URL}/api/v0/devices/{id}` with `X-Auth-Token`, ~3s timeout,
  all ids fetched in parallel; any failure → `{ up: null, downSince: null }`.
- `status` field → up/down; `last_polled`/downtime fields → downSince where
  available (exact field mapping confirmed against the live API during build).
- Never throws; missing env vars → every status null (page shows inventory only).

## Client page — `/connectivity`

- Card per active line: label; kind + speed ("Fibre · 100/50 Mbps · Openserve");
  status pill — **Online** (good) / **Down** + "since HH:MM" (bad) /
  **Status unavailable** (muted) / no pill when unmapped.
- "Report a problem" per line → `/support/new?subject=` prefilled
  (`Line problem: {label}`) — the new-ticket form reads the param to prefill.
- Empty state (no services): "No connectivity services on your account yet."
- Nav: "Connectivity" at the TOP of Your services, shown only when the client
  has ≥1 active service (billingEnabled pattern: layout passes
  `connectivityEnabled`).
- Feature access: add `connectivity` to `FEATURES` / `FEATURE_LABELS` /
  `FEATURE_HREFS` (manager default on, member off, staff bypass — no migration
  needed, `has_feature` works on any key; RLS enforcement not required for v1 —
  operational data, page+nav gated like devices).
- Activity feed: add `connectivity` to the section map/labels so visits track.

## Admin

`ConnectivitySection` card on the admin client page (below SupportSection):
list of lines incl. inactive (tagged), add form (label, kind, provider,
speeds, LibreNMS id, notes), edit inline or simplest-possible, deactivate
(soft) + delete. Staff-guarded actions in `lib/actions/connectivity.ts`.
Admin card also shows live status pills (same proxy) so staff see what the
client sees.

## Testing

- Vitest: status mapping (LibreNMS payload → LineStatus), speed/label
  formatting helper, feature/nav additions covered by existing access tests
  pattern (add `connectivity` cases).
- Manual/programmatic: seed a line for a real client, map a LibreNMS device,
  verify live pill; kill env var → inventory-only rendering; RLS spot-check
  (client reads only own lines); report-a-problem prefill lands in the form.

## Out of scope (Slice 1)

Outage history, availability %, bandwidth/usage graphs, known-outage banners,
contract/pricing fields, upgrade-request flow, public status page, member
default access.
