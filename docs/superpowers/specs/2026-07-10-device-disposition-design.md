# Device Disposition — Design

**Date:** 2026-07-10
**Status:** Approved in conversation (Shawn), incl. manager editability.

## Purpose

Datto shows every enrolled device as if it's in active service, which makes fleet
health misleading: spares and machines awaiting parts look like problems, and
devices that aren't the client's at all look like our responsibility. Monique's
June 2026 GSR report review surfaced six such corrections with nowhere to live.

Add a **disposition** to each device — the first *portal-owned* device field
(not synced from Datto). Per Shawn: portal-owned device fields are editable by
**Rocking staff AND the client's managers**; Datto-synced fields stay read-only.

## Data model

Migration `0043_device_disposition.sql`, columns on `public.devices`:

- `disposition text not null default 'in_use'`
  check in (`'in_use'`, `'spare'`, `'awaiting_repair'`, `'to_remove'`)
- `disposition_note text` — free text, e.g. "awaiting charger; Tracey using GG5234"
- `disposition_updated_at timestamptz`, `disposition_updated_by uuid references profiles on delete set null`

`datto-pull.mjs` upserts only the columns it provides, so these survive syncs
untouched (same mechanism that preserves `person_id`).

## Write path — RPC, not RLS update

Managers must edit disposition but never Datto columns; RLS is row-level, so an
UPDATE policy can't scope columns. Follow the repo's SECURITY DEFINER RPC
pattern (`claim_device`, `set_portal_role`):

`set_device_disposition(p_device_id uuid, p_disposition text, p_note text)`
— security definer, search_path public. Allowed when `is_rocking_staff()` OR
(`current_user_role() = 'client_manager'` AND the device's `client_id =
current_client_id()`). Validates the disposition value, stamps
`disposition_updated_at/by` with `now()`/`auth.uid()`. Grant execute to
authenticated. Members and other clients' managers get an exception.

## Server action

`lib/actions/device-disposition.ts` (`"use server"`):
`setDeviceDisposition(deviceId, formData)` → calls the RPC through the RLS
client (auth enforcement lives in the RPC), then revalidates
`/admin/devices/{id}` and `/devices/{id}`.

## UI

- `components/DeviceDisposition.tsx` — server component `{ deviceId, canEdit }`.
  Fetches the disposition columns itself (same pattern as `DevicePersonCard`).
  `canEdit`: a form with a select (In use / Spare / Awaiting repair / Flag for
  removal), a note input, Save; shows "updated {date}". Read-only: badge + note.
- Rendered on the admin device page (canEdit always) and the client device page
  (canEdit when the viewer is a `client_manager`).
- Fleet badge: pass `disposition` through the fleet views into `DeviceHealth`
  (display-only — health math unchanged) and show a small tag next to the
  device name in `DeviceTable` when disposition ≠ `in_use`.

## Out of scope

- Excluding spares from health/attention logic (revisit once dispositions are in use).
- Manual (non-Datto) device records — the two unenrolled GSR Lenovos need agents
  or a KB note instead.
- Editing other Datto fields; further portal-owned fields reuse this RPC pattern.

## Data entry (same change, via existing features)

From Monique's review: five `device_changes` hardware entries (GG5235 hinges
R3,663.33; GG5538 hinge R4,694.88; GG5247 keyboard R1,785.38; GG5269 battery;
GSR-YASEEN-LTP webcam), person corrections (GG5222 → Lynn Oersen; GSR-YASEEN-LTP
unlink), and dispositions: GSR-YASEEN-LTP / GG5538 / GG5235 / DESKTOP-JQAMGFF
spare, GST-Tracey awaiting_repair, GG5236 to_remove.
