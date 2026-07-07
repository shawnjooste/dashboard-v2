# Device Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can photograph a laptop's physical state on the device detail page; clients see photos of their own devices read-only.

**Architecture:** Mirror of the supplier-documents pattern: private Supabase storage bucket `device-photos` + `device_photos` table (staff-all RLS, client read of visible devices), staff-guarded server actions for upload/delete, signed URLs generated server-side in the view layer at render time. One shared `DevicePhotos` card rendered on both the admin and client device pages.

**Tech Stack:** Next.js 16 App Router (server components + server actions, `useActionState`), Supabase (Postgres RLS + Storage), vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-device-photos-design.md`.
**One deliberate deviation from the spec:** the spec's `devicePhotoUrl(photoId)` action (browser fetches a signed URL per photo on mount) is replaced by signing inside `getDevicePhotos` during server render. The RLS-scoped select still gates which rows exist to sign, so access control is identical — but there are no client-side URL round trips.

## Global Constraints

- Supabase project ref for this repo is `eskhokedsximnslgsycs` (dashboard-v2) — **never** `qomxwxxulxcwnpaqzudl`.
- All commands run from the repo root `/Users/shawnjooste/Documents/Claude/dashboard-v2`.
- Migrations: `npx supabase db push --linked`. Types: `npx supabase gen types typescript --linked > lib/types/database.ts`.
- Max photo size 10 MB; images only (`image/*`).
- Bucket `device-photos` is private; the browser only ever sees 1-hour signed URLs.
- Vitest cannot import files that transitively pull in `@/lib/supabase/server` — pure helpers live in their own file (established repo convention, see `lib/views/rfq-helpers.ts`).
- UI must use the existing design tokens/components (`Card`, `CardHeader` from `@/components/ui`; `border-line-soft`, `text-muted`, `text-faint`, `bg-canvas`, `text-brand` etc.) — match `app/(admin)/admin/devices/[id]/DeviceChangeLog.tsx`.
- Commit messages follow the repo's `feat:`/`docs:` convention.
- If a git command hangs on `.git/index.lock`, Cursor's git worker holds it — remove the stale lock and retry (known issue in this environment).

---

### Task 1: Pure helpers + tests (TDD)

**Files:**
- Create: `lib/device-photo-helpers.ts`
- Test: `lib/device-photo-helpers.test.ts`

**Interfaces:**
- Produces: `MAX_PHOTO_BYTES: number`, `safePhotoName(name: string): string`, `photoError(file: { type: string; size: number; name: string }): string | null` — Task 3 imports all three.

- [ ] **Step 1: Write the failing test**

`lib/device-photo-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, photoError, safePhotoName } from "./device-photo-helpers";

describe("safePhotoName", () => {
  it("keeps safe characters", () => {
    expect(safePhotoName("IMG_2041.jpeg")).toBe("IMG_2041.jpeg");
  });
  it("replaces spaces and specials", () => {
    expect(safePhotoName("cracked hinge (front).jpg")).toBe("cracked_hinge__front_.jpg");
  });
});

describe("photoError", () => {
  it("accepts a normal photo", () => {
    expect(photoError({ type: "image/jpeg", size: 3_000_000, name: "a.jpg" })).toBeNull();
  });
  it("rejects non-images", () => {
    expect(photoError({ type: "application/pdf", size: 1000, name: "doc.pdf" })).toMatch(/not an image/);
  });
  it("rejects oversized files", () => {
    expect(photoError({ type: "image/png", size: MAX_PHOTO_BYTES + 1, name: "big.png" })).toMatch(/10 MB/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/device-photo-helpers.test.ts`
Expected: FAIL — "Cannot find module './device-photo-helpers'" (or equivalent resolve error).

- [ ] **Step 3: Write minimal implementation**

`lib/device-photo-helpers.ts`:

```ts
/** Pure validation/naming helpers for device photos — no server imports (vitest-safe). */

export const MAX_PHOTO_BYTES = 10_000_000;

export function safePhotoName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Returns a human-readable error, or null when the file is an acceptable photo. */
export function photoError(file: { type: string; size: number; name: string }): string | null {
  if (!file.type.startsWith("image/")) return `${file.name}: not an image.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: over the 10 MB limit.`;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/device-photo-helpers.test.ts`
Expected: 5 tests PASS. Then run the full suite `npm test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add lib/device-photo-helpers.ts lib/device-photo-helpers.test.ts
git commit -m "feat(device-photos): pure name/validation helpers"
```

---

### Task 2: Migration — table, RLS, bucket + regenerated types

**Files:**
- Create: `supabase/migrations/0042_device_photos.sql`
- Modify: `lib/types/database.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: table `public.device_photos` (columns below) and private storage bucket `device-photos`. Tasks 3–4 read/write both.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0042_device_photos.sql`:

```sql
-- Photos of a device's physical state (cracked hinge, swollen battery, general
-- condition). Staff upload/delete; clients view photos of devices they can see.
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

alter table public.device_photos enable row level security;

create policy device_photos_staff on public.device_photos
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients: read-only on photos of devices they can already see. The subquery
-- runs under the caller's own devices RLS, so photo visibility exactly mirrors
-- device visibility (manager: their client's fleet; member: assigned machines).
-- devices' policies don't reference device_photos, so no RLS recursion.
create policy device_photos_client_read on public.device_photos
  for select using (device_id in (select id from public.devices));

-- Private storage bucket for the images (server-side access only). -----------
insert into storage.buckets (id, name, public)
values ('device-photos', 'device-photos', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Push the migration**

Run: `npx supabase db push --linked`
Expected: "Applying migration 0042_device_photos.sql... Finished". If it prompts for confirmation, confirm the linked ref is `eskhokedsximnslgsycs` before saying yes.

- [ ] **Step 3: Regenerate types**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts`
Then: `npx tsc --noEmit` (or `npm run build` if that's faster to trust).
Expected: `device_photos` appears in `lib/types/database.ts`; typecheck passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0042_device_photos.sql lib/types/database.ts
git commit -m "feat(device-photos): device_photos table, RLS, private bucket"
```

---

### Task 3: Server actions — upload + delete

**Files:**
- Create: `lib/actions/device-photos.ts`

**Interfaces:**
- Consumes: `photoError`, `safePhotoName` from `lib/device-photo-helpers` (Task 1); `device_photos` table + `device-photos` bucket (Task 2); `getCurrentProfile` from `@/lib/auth/profile`; `createClient` from `@/lib/supabase/server`; `createServiceClient` from `@/lib/supabase/service`.
- Produces: `uploadDevicePhotos(deviceId: string, _prev: PhotoUploadResult | null, formData: FormData): Promise<PhotoUploadResult>` with `type PhotoUploadResult = { ok: true } | { ok: false; error: string }`, and `deleteDevicePhoto(photoId: string, deviceId: string): Promise<void>`. Task 5 binds both.

- [ ] **Step 1: Write the actions file**

`lib/actions/device-photos.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { photoError, safePhotoName } from "@/lib/device-photo-helpers";

const BUCKET = "device-photos";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

function revalidateDevice(deviceId: string) {
  revalidatePath(`/admin/devices/${deviceId}`);
  revalidatePath(`/devices/${deviceId}`);
}

export type PhotoUploadResult = { ok: true } | { ok: false; error: string };

/** Staff-only. Uploads every valid image in the batch; invalid files are
 *  reported but don't block the others. Caption applies to the whole batch. */
export async function uploadDevicePhotos(
  deviceId: string,
  _prev: PhotoUploadResult | null,
  formData: FormData,
): Promise<PhotoUploadResult> {
  const me = await staff();
  const caption = String(formData.get("caption") ?? "").trim() || null;
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Pick at least one image." };

  const service = createServiceClient();
  const supabase = await createClient();
  const errors: string[] = [];

  for (const file of files) {
    const invalid = photoError(file);
    if (invalid) {
      errors.push(invalid);
      continue;
    }
    const path = `${deviceId}/${crypto.randomUUID()}-${safePhotoName(file.name)}`;
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upErr) {
      errors.push(`${file.name}: ${upErr.message}`);
      continue;
    }
    const { error: insErr } = await supabase.from("device_photos").insert({
      device_id: deviceId,
      storage_path: path,
      caption,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by_profile_id: me.id,
    });
    if (insErr) {
      await service.storage.from(BUCKET).remove([path]); // no orphan file
      errors.push(`${file.name}: ${insErr.message}`);
    }
  }

  revalidateDevice(deviceId);
  return errors.length ? { ok: false, error: errors.join(" ") } : { ok: true };
}

export async function deleteDevicePhoto(photoId: string, deviceId: string) {
  await staff();
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("device_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();
  if (photo?.storage_path) await createServiceClient().storage.from(BUCKET).remove([photo.storage_path]);
  await supabase.from("device_photos").delete().eq("id", photoId);
  revalidateDevice(deviceId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/device-photos.ts
git commit -m "feat(device-photos): staff upload/delete server actions"
```

---

### Task 4: View layer — RLS-scoped photos with signed URLs

**Files:**
- Create: `lib/views/device-photos.ts`

**Interfaces:**
- Consumes: `device_photos` table + bucket (Task 2).
- Produces: `type DevicePhoto = { id: string; caption: string | null; createdAt: string; author: string | null; url: string | null }` and `getDevicePhotos(deviceId: string): Promise<DevicePhoto[]>`. Task 5 renders this.

- [ ] **Step 1: Write the view file**

`lib/views/device-photos.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "device-photos";

export type DevicePhoto = {
  id: string;
  caption: string | null;
  createdAt: string;
  author: string | null;
  url: string | null;
};

/**
 * Photos of a device visible to the current user, newest first. The select
 * runs under RLS (staff: all; clients: only their own devices' photos), and
 * we only sign URLs for rows RLS returned — so the signed URLs inherit the
 * same access control. URLs are valid for 1 hour (one server render).
 * Author resolution uses the caller's RLS view of profiles; client users
 * can't see staff profiles, so for them author is simply null.
 */
export async function getDevicePhotos(deviceId: string): Promise<DevicePhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("device_photos")
    .select("id, caption, storage_path, uploaded_by_profile_id, created_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false });
  if (!data?.length) return [];

  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };

  const { data: signed } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrls(data.map((p) => p.storage_path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((p) => ({
    id: p.id,
    caption: p.caption,
    createdAt: p.created_at,
    author: label(p.uploaded_by_profile_id),
    url: urlByPath.get(p.storage_path) ?? null,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/views/device-photos.ts
git commit -m "feat(device-photos): view layer with server-signed URLs"
```

---

### Task 5: UI — Photos card on both device pages

**Files:**
- Create: `components/DevicePhotos.tsx` (server component)
- Create: `components/AddDevicePhotos.tsx` (client component)
- Modify: `app/(admin)/admin/devices/[id]/page.tsx` (render with `isStaff`)
- Modify: `app/(app)/devices/[id]/page.tsx` (render read-only)

**Interfaces:**
- Consumes: `getDevicePhotos` (Task 4); `uploadDevicePhotos`, `deleteDevicePhoto`, `PhotoUploadResult` (Task 3); `Card`, `CardHeader` from `@/components/ui`.
- Produces: `<DevicePhotos deviceId={string} isStaff={boolean} />`.

- [ ] **Step 1: Write the upload form (client component)**

`components/AddDevicePhotos.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { uploadDevicePhotos, type PhotoUploadResult } from "@/lib/actions/device-photos";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function AddDevicePhotos({ deviceId }: { deviceId: string }) {
  const [state, formAction, pending] = useActionState<PhotoUploadResult | null, FormData>(
    uploadDevicePhotos.bind(null, deviceId),
    null,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
      <input type="file" name="photos" accept="image/*" multiple required className={`${FIELD} min-w-0 flex-1`} />
      <input name="caption" placeholder="Caption (optional), e.g. Cracked hinge" className={`${FIELD} min-w-0 flex-1`} />
      <button
        disabled={pending}
        className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Add photos"}
      </button>
      {state && !state.ok && <p className="w-full text-xs text-brand">{state.error}</p>}
    </form>
  );
}
```

Note: `accept="image/*"` without a `capture` attribute — on mobile this offers both camera and photo library; `capture` would force camera-only.

- [ ] **Step 2: Write the photos card (server component)**

`components/DevicePhotos.tsx`:

```tsx
import { getDevicePhotos } from "@/lib/views/device-photos";
import { deleteDevicePhoto } from "@/lib/actions/device-photos";
import { Card, CardHeader } from "@/components/ui";
import { AddDevicePhotos } from "./AddDevicePhotos";

const fmt = (ts: string) => ts.replace("T", " ").slice(0, 16);

/** Photos of the device's physical state. Staff upload/delete; clients view. */
export async function DevicePhotos({ deviceId, isStaff }: { deviceId: string; isStaff: boolean }) {
  const photos = await getDevicePhotos(deviceId);
  if (!isStaff && photos.length === 0) return null; // nothing to show a client

  return (
    <Card>
      <CardHeader title="Photos" count={photos.length} />
      {isStaff && <AddDevicePhotos deviceId={deviceId} />}
      {photos.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p) => {
            const remove = deleteDevicePhoto.bind(null, p.id, deviceId);
            return (
              <li key={p.id} className="min-w-0">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" title="Open full size">
                    {/* Signed URLs are per-render and expire hourly — next/image adds nothing here. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.caption ?? "Device photo"}
                      className="aspect-square w-full rounded-lg border border-line object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-line bg-canvas text-xs text-faint">
                    unavailable
                  </div>
                )}
                {p.caption && <p className="mt-1 truncate text-xs text-ink-3" title={p.caption}>{p.caption}</p>}
                <p className="mt-0.5 flex items-center justify-between text-[11px] text-faint">
                  <span>
                    {fmt(p.createdAt)}
                    {p.author ? <span className="capitalize"> · {p.author}</span> : ""}
                  </span>
                  {isStaff && (
                    <form action={remove}>
                      <button className="text-faint hover:text-brand" title="Delete photo">
                        Remove
                      </button>
                    </form>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Wire into the admin device page**

In `app/(admin)/admin/devices/[id]/page.tsx`, add the import and render between `DeviceChangeLog` and `DeviceAdminExtras`:

```tsx
import { DevicePhotos } from "@/components/DevicePhotos";
```

```tsx
      <DevicePersonCard deviceId={id} />
      <DeviceDetailView detail={detail} />
      <DeviceChangeLog deviceId={id} />
      <DevicePhotos deviceId={id} isStaff />
      <DeviceAdminExtras meta={detail.meta} extras={extras} />
```

- [ ] **Step 4: Wire into the client device page**

In `app/(app)/devices/[id]/page.tsx`, add the import and render after `DeviceDetailView`:

```tsx
import { DevicePhotos } from "@/components/DevicePhotos";
```

```tsx
      <DeviceDetailView detail={detail} />
      <DevicePhotos deviceId={id} isStaff={false} />
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles clean; both device routes build.

- [ ] **Step 6: Commit**

```bash
git add components/DevicePhotos.tsx components/AddDevicePhotos.tsx "app/(admin)/admin/devices/[id]/page.tsx" "app/(app)/devices/[id]/page.tsx"
git commit -m "feat(device-photos): photos card on admin + client device pages"
```

---

### Task 6: Verify end-to-end + push

**Files:** none new — verification and push only.

- [ ] **Step 1: Full test suite + build**

Run: `npm test && npm run build`
Expected: all vitest suites pass; build clean.

- [ ] **Step 2: Manual verification (staff path)**

Start dev (`npm run dev`) or use the deployed preview after push. As a staff user on any `/admin/devices/[id]`:
- Upload a single image → thumbnail appears, caption + "date · name" shown.
- Upload two images at once → both appear.
- Upload a PDF → rejected with "not an image", page still fine.
- Click a thumbnail → full-size opens in a new tab (signed URL).
- Remove a photo → gone from the grid; confirm the object is gone from the
  `device-photos` bucket (Supabase dashboard → Storage) — no orphans.

- [ ] **Step 3: Manual verification (client path)**

As a client user (e.g. a test manager) on `/devices/[id]` for one of their own devices with photos:
- Photos card renders read-only — no upload form, no Remove buttons.
- A device with no photos shows no Photos card at all.
- RLS spot-check via SQL or a member login: a photo of another client's device is not returned.

- [ ] **Step 4: Push**

```bash
git push origin main
```
Expected: Vercel deploys; spot-check one admin device page in production.
