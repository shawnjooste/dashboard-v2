# Client Suspension Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a client is suspended, everyone at that client sees a persistent banner on every portal page explaining what's paused and what to do — and staff can set or lift it in one click.

**Architecture:** Two nullable columns on `clients` (`suspended_at`, `suspension_note`); the client layout already fetches that row, so the banner costs no extra query; `AppShell` renders it above the content in the same slot as the existing impersonation banner. A staff-only action toggles it from the admin client page.

**Tech Stack:** Next.js 16 (server components + actions), Supabase Postgres/RLS.

**Design decisions (agreed with Shawn 2026-08-04):**
- This is a **notice, not a mechanism** — nothing is gated. Portal stays fully open: login, billing and support all work. The suspension is of real-world services; the banner just tells the truth.
- **Do NOT reuse `clients.status = 'inactive'`** — that means *archived*, and `lib/views/admin-dashboard.ts` counts clients as `status !== "inactive"`, so a suspended client would vanish from admin counts exactly when they need chasing.
- No automated email (Shawn sends that personally after a phone call), no scheduled/auto-suspension, no general-purpose announcement system.

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; verify `cat supabase/.temp/project-ref` before push. Commands from repo root.
- Migration **0078** — verify still free at build time (`ls supabase/migrations`); parallel sessions are active.
- `suspended_at` being non-null IS the flag. No boolean, no enum, no new status value.
- Banner is **not dismissible** and shows for every role at that client (members included — if services are down they'll hit it either way).
- Amber/warn tone (`bg-warn-tint text-warn-ink`), matching the impersonation banner — this is "action needed", not "error".
- Quote parenthesized paths in shell. Stale `.next/* 2.*` files break tsc — `find .next -name "* 2.*" -delete` if it complains.

---

### Task 1: Migration — suspension columns

**Files:**
- Create: `supabase/migrations/0078_client_suspension.sql`
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces: `clients.suspended_at timestamptz null`, `clients.suspension_note text null`. Tasks 2–3 read/write these.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0078_client_suspension.sql`:

```sql
-- Service suspension is a NOTICE, not a gate: the portal stays fully open
-- (they must be able to see billing and reach support), and these columns
-- only drive the banner telling them what's paused and what to do.
--
-- Deliberately NOT clients.status='inactive' — that means ARCHIVED, and the
-- admin dashboard counts clients as status <> 'inactive', so overloading it
-- would hide a suspended client from staff exactly when they're being chased.
alter table public.clients
  add column suspended_at   timestamptz,
  add column suspension_note text;

comment on column public.clients.suspended_at is
  'Non-null = services suspended; drives the portal banner. Not a gate.';
```

- [ ] **Step 2: Push (verify ref and number first)**

Run: `cat supabase/.temp/project-ref` → must print `eskhokedsximnslgsycs`; `ls supabase/migrations | tail -3` → confirm 0078 is free. Then `npx supabase db push --linked`.
Expected: "Applying migration 0078_client_suspension.sql... Finished".

- [ ] **Step 3: Regenerate types + typecheck**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts` then `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: `suspended_at` present in the types; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0078_client_suspension.sql lib/types/database.ts
git commit -m "feat(suspension): client suspension columns"
```

---

### Task 2: The banner

**Files:**
- Modify: `app/(app)/layout.tsx` (extend the existing client select; pass the note down)
- Modify: `components/AppShell.tsx` (render the banner)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `AppShell` prop `suspensionNote?: string | null` — non-null renders the banner.

- [ ] **Step 1: Read the columns in the layout**

In `app/(app)/layout.tsx`, extend the existing clients select (it already fetches this row, so no extra query):

```ts
      supabase.from("clients").select("name, xero_contact_id, suspended_at, suspension_note").eq("id", me.profile.client_id).maybeSingle(),
```

Add a variable alongside `accountName` / `billingEnabled`, declared with them (`let suspensionNote: string | null = null;`) and set in the same block:

```ts
    // Non-null suspended_at is the flag; the note is what they actually read.
    suspensionNote = client?.suspended_at
      ? (client.suspension_note ?? "Some of your services are currently suspended.")
      : null;
```

then pass it to `AppShell`: `suspensionNote={suspensionNote}`.

- [ ] **Step 2: Render it in AppShell**

In `components/AppShell.tsx`, add the prop to the signature and its type:

```ts
  suspensionNote,
```
```ts
  /** Set when the client's services are suspended — renders a standing
   *  banner. A notice only; nothing in the portal is gated. */
  suspensionNote?: string | null;
```

and render it directly **below** the impersonation banner block (so a staff member impersonating still sees both), above `<div className="flex min-h-0 flex-1 md:flex-row">`:

```tsx
      {suspensionNote && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-warn-tint px-4 py-2.5 text-sm text-warn-ink print:hidden">
          <span>
            <strong>Some services are suspended.</strong> {suspensionNote}
          </span>
          <a
            href="/billing"
            className="shrink-0 rounded border border-warn-line px-3 py-0.5 font-medium hover:bg-warn-tint-2"
          >
            View billing
          </a>
        </div>
      )}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/layout.tsx" components/AppShell.tsx
git commit -m "feat(suspension): persistent portal banner for suspended clients"
```

---

### Task 3: Admin toggle

**Files:**
- Create: `app/(admin)/admin/clients/[id]/SuspensionSection.tsx`
- Modify: `app/(admin)/admin/clients/actions.ts` (add the action)
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (render the section first)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `setSuspension(clientId: string, formData: FormData)` (staff-guarded); `<SuspensionSection clientId={string} />`.

- [ ] **Step 1: The action**

Append to `app/(admin)/admin/clients/actions.ts` (it already has a staff guard pattern and `createClient` — match whatever the file uses):

```ts
/**
 * Staff-only: suspend a client's services (or lift it). Sets the banner every
 * user at that client sees. A notice only — nothing in the portal is gated,
 * so they can still pay and still reach support.
 */
export async function setSuspension(clientId: string, formData: FormData) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  const suspend = String(formData.get("suspend") ?? "") === "on";
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update(
      suspend
        ? { suspended_at: new Date().toISOString(), suspension_note: note }
        : { suspended_at: null, suspension_note: null },
    )
    .eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/", "layout"); // the banner lives in the client layout
}
```

Add `getCurrentProfile` / `revalidatePath` imports if the file lacks them.

- [ ] **Step 2: The section component**

`app/(admin)/admin/clients/[id]/SuspensionSection.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { setSuspension } from "../actions";
import { Card, CardHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Staff-only: suspend/restore this client's services. Setting it shows a
 *  standing banner to every user at the client; lifting it removes it
 *  immediately. Nothing is gated either way. */
export async function SuspensionSection({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("suspended_at, suspension_note")
    .eq("id", clientId)
    .maybeSingle();
  const suspended = !!client?.suspended_at;
  const save = setSuspension.bind(null, clientId);

  return (
    <Card>
      <CardHeader title="Service suspension" count={suspended ? "Suspended" : "Active"} />
      <form action={save} className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        <label className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
          <input type="checkbox" name="suspend" defaultChecked={suspended} />
          Suspended
        </label>
        <input
          name="note"
          defaultValue={client?.suspension_note ?? ""}
          placeholder="What's paused and what they should do — shown to every user at this client"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Save
        </button>
      </form>
      {suspended && (
        <p className="px-4 pb-3.5 text-xs text-muted">
          Suspended {client?.suspended_at?.slice(0, 10)} — the banner is live for this client now.
          Untick and save to lift it.
        </p>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Render it on the client page**

In `app/(admin)/admin/clients/[id]/page.tsx`: `import { SuspensionSection } from "./SuspensionSection";` and render `<SuspensionSection clientId={id} />` immediately after `<SummaryStrip …/>` (before `SupportSection`), so a suspended client's state is the first thing staff see.

- [ ] **Step 4: Build**

Run: `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/SuspensionSection.tsx" "app/(admin)/admin/clients/actions.ts" "app/(admin)/admin/clients/[id]/page.tsx"
git commit -m "feat(suspension): admin suspend/restore toggle"
```

---

### Task 4: Verify + push

- [ ] **Step 1:** `npm test && npm run build` — both green.
- [ ] **Step 2: live round-trip** — with the service role, set `suspended_at` + a note on a real test client, confirm the row reads back; clear it; confirm null. Verify a client user's own RLS read returns the columns (they already read this row for `name`, so no policy change should be needed — prove it rather than assume).
- [ ] **Step 3:** Push to `main`; after deploy, health-check `/` and `/admin/clients` (307 → login unauthenticated). Do **not** suspend a real client as part of testing — Shawn sets the live one himself, or asks for it explicitly with the exact wording.
