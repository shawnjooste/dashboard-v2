# Device Photos — Design

**Date:** 2026-07-07
**Status:** Approved (Approach A)

## Purpose

Let Rocking staff photograph the current physical state of a laptop (cracked hinge,
swollen battery, general condition) and attach the pictures to the device's detail
page alongside its Datto data. Staff upload and delete; clients can view photos of
their own devices read-only.

## Decisions

- **Standalone photo section** on the device detail page — not attached to
  change-log entries. Quick "here's what it looks like" snaps with an optional caption.
- **Staff upload/delete, clients view.** The photos card renders on both the admin
  device page and the client device page; upload and delete controls exist only for staff.
- **Private bucket + signed URLs** (mirror of the supplier-documents pattern in
  `0035_suppliers.sql` / `app/(admin)/admin/suppliers/actions.ts`). No public URLs.

## Data model

Migration `supabase/migrations/0042_device_photos.sql`:

```sql
create table public.device_photos (
  id                     uuid primary key default gen_random_uuid(),
  device_id              uuid not null references public.devices(id) on delete cascade,
  storage_path           text not null,
  caption                text,
  file_size              integer,
  mime_type              text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index device_photos_device_idx on public.device_photos (device_id);
```

RLS:
- Staff: `for all using (is_rocking_staff()) with check (is_rocking_staff())`.
- Clients: `for select` where the photo's device belongs to `current_client_id()`
  (join through `devices.client_id`).

Storage: private bucket `device-photos` (`public = false`), objects at
`{device_id}/{uuid}-{safe_name}`. Server-side access only (service client); no
storage-level policies needed beyond the private default.

## Server actions

New file `lib/actions/device-photos.ts` (`"use server"`), importable from both the
admin and client route groups. Reuse the `requireStaff` guard pattern from
`app/(admin)/admin/devices/[id]/actions.ts`:

- `uploadDevicePhotos(deviceId, formData)` — staff-only. Accepts one or more files
  from a single input. Per file: must be `image/*`, ≤ 10 MB. Sanitize the filename,
  upload to the bucket with the service client, insert the `device_photos` row
  (caption applies to all files in the batch; usually one file). On row-insert
  failure, remove the uploaded object (no orphans). `revalidatePath` both device pages.
- `deleteDevicePhoto(photoId)` — staff-only. Remove the storage object, then the row.
- `devicePhotoUrl(photoId)` — access-checked signed URL. Reads the row through the
  **RLS client** (so staff get any photo, clients only their own devices' photos),
  then signs a 1-hour URL with the service client. Returns `null` when not visible.

## View layer

`lib/views/devices.ts`: add `DevicePhoto` type
(`{ id, caption, fileSize, createdAt, uploadedBy }` — no storage path exposed) and
`getDevicePhotos(deviceId)` using the RLS client, newest first. RLS makes the same
query correct for staff and clients.

## UI

New `components/DevicePhotos.tsx` — a Card ("Photos", count badge):

- Thumbnail grid (images load via signed URLs fetched per photo; a small client
  component requests the URL on mount and renders the `<img>`).
- Click a thumbnail → open the full-size signed URL in a new tab.
- Under each photo: caption (if any) + "Added by {name} · {date}" in muted text.
- Staff-only controls (driven by an `isStaff` prop from the server page, enforced
  again in the actions): "Add photos" button → file input
  (`accept="image/*"`, `multiple`, `capture` enabled for mobile camera) + optional
  caption field; a delete button per photo with confirm.
- Empty state: "No photos yet." (staff also see the Add button).

Rendered on:
- `/admin/devices/[id]` (`isStaff = true`).
- The client device detail page (`isStaff = false`).

Design tokens: existing `Card`, `CardHeader`, `bg-card border-line`, muted/faint
text classes — match `DeviceChangeLog.tsx`.

## Error handling

- Reject non-image or >10 MB files with a per-file message; other valid files in
  the batch still upload.
- Upload succeeded but insert failed → storage object removed, error returned.
- Signed-URL request for a photo you can't see → `null` → thumbnail not rendered.

## Testing

- Vitest on pure helpers (filename sanitizer, validation predicate) if split out.
- Manual: upload (single + multi) as staff, thumbnails render, full-size opens,
  delete works; as a client user, photos of own device visible read-only, no
  controls; photo of another client's device not visible (RLS).

## Out of scope

- Image resizing/thumbnailing (browser loads the original; fine at this scale).
- Photos on the fleet/table views.
- Client uploads.
- Attaching photos to change-log entries (revisit if wanted later).
