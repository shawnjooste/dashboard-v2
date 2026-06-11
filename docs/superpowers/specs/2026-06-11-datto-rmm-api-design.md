# Datto RMM API Pull + Device Identity Rewrite — Design

**Date:** 2026-06-11
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Datto data is currently ingested by pasting CSV exports. Datto RMM has a REST API (merlot zone,
`https://merlot-api.centrastage.net`), auth via account API key+secret → client-credentials token
(~100h, headless). Probed live: sites → devices → per-device audit → open alerts cover everything
the CSV did, plus a **stable device `uid`**. This slice replaces the manual export with a headless
`datto-pull` CLI **and** rewrites device identity onto the Datto `uid` (retiring the fragile
`device_identity = coalesce(serial, hostname)` key).

## Identity rewrite (the core decision)

`devices.datto_uid` (text, **unique**, nullable during migration) becomes the canonical key — the
source system's permanent id, stable across hostname/serial changes. `device_identity` is dropped.

Reconciliation (non-destructive, preserves device claims + snapshot history):
1. Migration `0017`: add `datto_uid` + unique index; drop `NOT NULL` on `device_identity`.
2. First `datto-pull`: for each API device, if no row has its `datto_uid`, match an existing row by
   `(client_id, hostname)` with null `datto_uid` and **backfill** the uid; then upsert on `datto_uid`.
3. Migration `0018`: drop `device_identity` + its unique index (all rows now carry `datto_uid`).

CSV ingester (`scripts/ingest-datto.mjs`) is updated to reconcile by `(client_id, hostname)` (code-
level select-then-upsert, no `device_identity`) so it survives as an emergency fallback; the API
pull is canonical.

## Auth + fetch — `lib/datto-rmm.mjs` (CLI shared)

- `getToken()` — POST `/auth/oauth/token`, Basic `public-client:public`, body
  `grant_type=password&username={KEY}&password={SECRET}`. Returns access token.
- `dattoGet(token, path)` / `dattoPaged(token, path, collectionKey)` — GET + follow
  `pageDetails.nextPageUrl`. Reads `DATTO_RMM_URL/KEY/SECRET` from `.env.local`.

## Field mapping (confirmed against live API)

- **Sites → clients** via existing `site_aliases` (site `name` → client). System sites (`Managed`,
  `OnDemand`, `Deleted Devices`) and any unmapped site are skipped + reported.
- **devices**: `datto_uid`=uid, hostname, `assigned_user_label`=description, `operating_system`,
  `last_reboot`=lastReboot (epoch ms→ISO), `external_ip`=extIpAddress, `agent_version`=cagVersion,
  `av_status_raw`=antivirus.antivirusStatus, `av_ok`= status starts with "Running".
  From `/audit/device/{uid}`: `manufacturer`/`model`/`memory`/`physical_cores`/`cpu`=systemInfo,
  `serial_number`=baseBoard/bios serial.
- **device_patch_status**: from device.patchManagement {patchStatus, patchesInstalled,
  patchesApprovedPending, patchesNotApproved}. (Note: API uses `RebootRequired`/`InstallError`
  without spaces — see health-flag note below.)
- **device_storage**: from audit `logicalDisks` (diskIdentifier→drive, size, freespace → used/free
  GB + %, only "Local Fixed Disk"). Replaced per device per run.
- **device_alerts**: `/account/alerts/open` (+ resolved via `/account/alerts/resolved` first page) →
  matched to device by `alertSourceInfo.deviceUid` → our `datto_uid`. triggered_at=timestamp,
  message=diagnostics or alertMonitorInfo, priority, resolved, resolved_at=resolvedOn,
  ticket_number=ticketNumber.
- **device_health_snapshots**: per device per run (patch_pct, max_disk_pct, av_ok, open_alert_count).
- `import_runs` row, `source='datto'`.

## Health-flag compatibility

`lib/views/health.ts` flags patch issues on the CSV strings `"Reboot Required"`/`"Install Error"`.
The API returns `RebootRequired`/`InstallError`. Extend the `PATCH_ISSUE` set to include both forms
(and keep the device's `rebootRequired` bool as a backstop) so the dashboard's attention logic keeps
working across both ingestion sources. Pure + unit-tested.

## Pull script — `scripts/datto-pull.mjs`

Idempotent. auth → sites → (mapped sites) → devices (paged) → per-device audit → patch/storage →
account alerts → upserts keyed on `datto_uid` (with first-run hostname backfill) → snapshots →
import_run counts. Per-device audit fan-out (~64 calls) is fine monthly; report skipped sites and
any device whose audit 404s (continue, partial data).

## Error handling

- Token failure → abort with message.
- A site/device call failing → log + continue (don't abort the whole pull); record in run `counts`.
- Audit 404 (device offline/never audited) → device row still upserted from the list data; storage/
  serial left as-is (not wiped).
- Idempotent: re-running overwrites current-state + the day's snapshot; alerts dedupe on
  (device_id, triggered_at, message).

## Testing

- Pure: extend health `PATCH_ISSUE` test for API forms; av_ok + epoch→ISO helpers if extracted.
- Live: run `datto-pull` against merlot → verify the 64 devices reconcile (datto_uid backfilled, no
  duplicates), storage/serial populate, alerts land, snapshot written; re-run for idempotency.
- build/tsc/lint green; regenerate `database.ts` after each migration.

## Out of scope

Datto BCDR/backup API, software inventory, scheduled auto-pull (additive later), web-initiated
connect (Datto uses a static key — no per-tenant connect needed; one account covers all sites).

## Files

- Create: `supabase/migrations/0017_datto_uid.sql`, `supabase/migrations/0018_drop_device_identity.sql`,
  `lib/datto-rmm.mjs`, `scripts/datto-pull.mjs`
- Modify: `scripts/ingest-datto.mjs` (reconcile by hostname), `lib/views/health.ts` (+test),
  `lib/types/database.ts` (regen)
