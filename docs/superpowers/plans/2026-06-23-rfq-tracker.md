# RFQ Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only RFQ (request-for-quote) Kanban tracker that sits at the front of the pipeline and links each request to the client quote that fulfils it.

**Architecture:** A trimmed sibling of the existing Jobs feature — a `rfqs` table + `rfq_events` activity log (staff-only RLS), a server-component board at `/admin/rfqs`, a detail page with a status control, an editable details form, and a "Link quote" action that attaches an existing client quote and advances the RFQ to Quoted. Pure display helpers (`rfqDisplayName`, `rfqCardTag`) are unit-tested; the rest is verified by a clean build + manual click-through, matching how Jobs/Suppliers were built in this repo.

**Tech Stack:** Next.js 16 (App Router, server components, server actions), Supabase (Postgres + RLS via `is_rocking_staff()`), Tailwind design tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-rfq-design.md`

**Pre-flight:** Confirm the repo is linked to the dashboard-v2 Supabase project (`eskhokedsximnslgsycs`, NOT the `qomxwxxulxcwnpaqzudl` "Dashboard" project) before pushing the migration: `supabase projects list` and check the linked (●) row, or `cat supabase/.temp/project-ref`.

---

## File Structure

- **Create** `supabase/migrations/0037_rfqs.sql` — `rfqs` + `rfq_events` tables, indexes, staff-only RLS.
- **Create** `lib/views/rfqs.ts` — types, status labels/board order, pure helpers (`rfqDisplayName`, `rfqCardTag`), and the three reader functions (`getRfqBoard`, `getRfqDetail`, `getRfqFormClients`).
- **Create** `lib/views/rfqs.test.ts` — unit tests for the two pure helpers.
- **Create** `app/(admin)/admin/rfqs/actions.ts` — server actions (`createRfq`, `setRfqStatus`, `linkQuote`, `saveRfqDetails`) + a private `logEvent` helper and `staff()` guard.
- **Create** `app/(admin)/admin/rfqs/page.tsx` — the board (server component).
- **Create** `app/(admin)/admin/rfqs/NewRfqDialog.tsx` — "+ New RFQ" modal (client component).
- **Create** `app/(admin)/admin/rfqs/[id]/page.tsx` — detail page (server component).
- **Create** `app/(admin)/admin/rfqs/[id]/RfqStatusControl.tsx` — stage buttons + sourcing/lost note (client component).
- **Create** `app/(admin)/admin/rfqs/[id]/LinkQuote.tsx` — link-an-existing-quote picker (client component).
- **Modify** `lib/nav.ts` — add "RFQs" first in the admin **Business** group.
- **Modify** `lib/types/database.ts` — regenerated after the migration.

---

### Task 1: Migration — `rfqs` + `rfq_events`

**Files:**
- Create: `supabase/migrations/0037_rfqs.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0037_rfqs.sql`:

```sql
-- RFQs — admin request-for-quote tracker. An RFQ is a card (optional client or
-- free-text prospect, who requested it, description, status, optional linked
-- quote) with an activity log. Staff-only throughout; clients never see these.

create table public.rfqs (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  client_id        uuid references public.clients(id) on delete set null,
  client_name      text,                       -- free-text client/prospect when no client_id
  requested_by     text,                       -- who asked (a customer contact or a team member)
  description      text,
  status           text not null default 'new'
                     check (status in ('new','sourcing','quoted','won','lost')),
  needed_by        date,
  sourcing_note    text,                        -- shown as the card tag while status = 'sourcing'
  notes            text,                        -- internal
  quote_id         uuid references public.quotes(id) on delete set null,
  lost_reason      text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index rfqs_status_idx on public.rfqs (status);
create index rfqs_client_idx on public.rfqs (client_id);

-- Activity log: 'created' / 'status' (stage change) / 'quote_linked' / 'note'.
create table public.rfq_events (
  id                   uuid primary key default gen_random_uuid(),
  rfq_id               uuid not null references public.rfqs(id) on delete cascade,
  kind                 text not null check (kind in ('created','status','quote_linked','note')),
  body                 text,
  posted_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index rfq_events_rfq_idx on public.rfq_events (rfq_id);

-- RLS: rocking_staff only (read + write). -----------------------------------
alter table public.rfqs       enable row level security;
alter table public.rfq_events enable row level security;

create policy rfqs_staff on public.rfqs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy rfq_events_staff on public.rfq_events
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
```

- [ ] **Step 2: Push the migration**

Run: `supabase db push --linked`
Expected: applies `0037_rfqs.sql` with no error. (If it lists unrelated pending migrations, stop and confirm the link is `eskhokedsximnslgsycs`.)

- [ ] **Step 3: Regenerate types**

Run: `supabase gen types typescript --linked > lib/types/database.ts`
Expected: `lib/types/database.ts` now contains `rfqs` and `rfq_events` — verify with `grep -c "rfq" lib/types/database.ts` (should be > 0).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0037_rfqs.sql lib/types/database.ts
git commit -m "feat(rfq): add rfqs + rfq_events tables (staff-only RLS)"
```

---

### Task 2: View layer + pure-helper tests

**Files:**
- Create: `lib/views/rfqs.ts`
- Test: `lib/views/rfqs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/views/rfqs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rfqDisplayName, rfqCardTag } from "./rfqs";

describe("rfqDisplayName", () => {
  it("prefers the linked client name", () => {
    expect(rfqDisplayName("GSR Law", "ignored")).toBe("GSR Law");
  });
  it("falls back to the prospect name", () => {
    expect(rfqDisplayName(null, "New Prospect")).toBe("New Prospect");
  });
  it("shows an em-dash when neither is set", () => {
    expect(rfqDisplayName(null, null)).toBe("—");
  });
});

describe("rfqCardTag", () => {
  it("tags the sourcing note while sourcing", () => {
    expect(rfqCardTag("sourcing", "awaiting Jurumani", null)).toEqual({ text: "awaiting Jurumani", tone: "warn" });
  });
  it("tags the quote number when quoted", () => {
    expect(rfqCardTag("quoted", null, "QU-CFS-003")).toEqual({ text: "QU-CFS-003", tone: "info" });
  });
  it("tags the quote number green when won", () => {
    expect(rfqCardTag("won", null, "QU-CFS-003")).toEqual({ text: "QU-CFS-003", tone: "good" });
  });
  it("has no tag for a new RFQ", () => {
    expect(rfqCardTag("new", null, null)).toBeNull();
  });
  it("has no sourcing tag without a note", () => {
    expect(rfqCardTag("sourcing", null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/views/rfqs.test.ts`
Expected: FAIL — cannot import `rfqDisplayName` / `rfqCardTag` (module not found).

- [ ] **Step 3: Write the view module**

Create `lib/views/rfqs.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type RfqStatus = "new" | "sourcing" | "quoted" | "won" | "lost";

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  new: "New",
  sourcing: "Sourcing",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
/** Columns shown on the board, in order. `lost` lives off-board. */
export const BOARD_STATUSES: RfqStatus[] = ["new", "sourcing", "quoted", "won"];

export type CardTag = { text: string; tone: "warn" | "info" | "good" };

/** Display name = linked client's name, else the free-text prospect, else em-dash. */
export function rfqDisplayName(linkedClientName: string | null, prospectName: string | null): string {
  return linkedClientName ?? prospectName ?? "—";
}

/** The single tag shown on a board card: the sourcing note, or the linked quote number. */
export function rfqCardTag(status: RfqStatus, sourcingNote: string | null, quoteNumber: string | null): CardTag | null {
  if (status === "sourcing" && sourcingNote) return { text: sourcingNote, tone: "warn" };
  if ((status === "quoted" || status === "won") && quoteNumber) {
    return { text: quoteNumber, tone: status === "won" ? "good" : "info" };
  }
  return null;
}

export type RfqCard = {
  id: string;
  title: string;
  clientLabel: string;
  requestedBy: string | null;
  status: RfqStatus;
  tag: CardTag | null;
  updatedAt: string;
};

export type RfqEvent = { id: string; kind: string; body: string | null; author: string | null; createdAt: string };
export type QuoteOption = { id: string; label: string };
export type ClientOption = { id: string; name: string };

export type RfqDetail = {
  id: string;
  title: string;
  clientId: string | null;
  clientLabel: string;
  requestedBy: string | null;
  description: string | null;
  neededBy: string | null;
  status: RfqStatus;
  sourcingNote: string | null;
  lostReason: string | null;
  notes: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  events: RfqEvent[];
  linkableQuotes: QuoteOption[];
};

/** A friendly label from an email local-part (staff rarely have people rows). */
function emailLabel(email: string | undefined | null): string | null {
  if (!email) return null;
  return email.split("@")[0].replace(/[._]/g, " ");
}

/** Every RFQ for the board (staff RLS). */
export async function getRfqBoard(): Promise<RfqCard[]> {
  const supabase = await createClient();
  const [{ data: rfqs }, { data: clients }, { data: quotes }] = await Promise.all([
    supabase
      .from("rfqs")
      .select("id, title, client_id, client_name, requested_by, status, sourcing_note, quote_id, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("clients").select("id, name"),
    supabase.from("quotes").select("id, quote_number"),
  ]);
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const qn = new Map((quotes ?? []).map((q) => [q.id, q.quote_number]));
  return (rfqs ?? []).map((r) => {
    const status = r.status as RfqStatus;
    const quoteNumber = r.quote_id ? qn.get(r.quote_id) ?? null : null;
    return {
      id: r.id,
      title: r.title,
      clientLabel: rfqDisplayName(r.client_id ? cn.get(r.client_id) ?? null : null, r.client_name),
      requestedBy: r.requested_by,
      status,
      tag: rfqCardTag(status, r.sourcing_note, quoteNumber),
      updatedAt: r.updated_at,
    };
  });
}

export async function getRfqDetail(id: string): Promise<RfqDetail | null> {
  const supabase = await createClient();
  const { data: r } = await supabase.from("rfqs").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: client }, { data: events }, { data: profiles }, quoteRes, linkable] = await Promise.all([
    r.client_id
      ? supabase.from("clients").select("name").eq("id", r.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("rfq_events").select("id, kind, body, posted_by_profile_id, created_at").eq("rfq_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, email"),
    r.quote_id
      ? supabase.from("quotes").select("quote_number").eq("id", r.quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    r.client_id
      ? supabase.from("quotes").select("id, quote_number, title").eq("client_id", r.client_id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const em = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const linkedName = (client as { name: string } | null)?.name ?? null;
  return {
    id: r.id,
    title: r.title,
    clientId: r.client_id,
    clientLabel: rfqDisplayName(linkedName, r.client_name),
    requestedBy: r.requested_by,
    description: r.description,
    neededBy: r.needed_by,
    status: r.status as RfqStatus,
    sourcingNote: r.sourcing_note,
    lostReason: r.lost_reason,
    notes: r.notes,
    quoteId: r.quote_id,
    quoteNumber: (quoteRes.data as { quote_number: string } | null)?.quote_number ?? null,
    events: (events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      author: emailLabel(em.get(e.posted_by_profile_id ?? "")),
      createdAt: e.created_at,
    })),
    linkableQuotes: ((linkable.data ?? []) as { id: string; quote_number: string; title: string }[]).map((q) => ({
      id: q.id,
      label: `${q.quote_number} · ${q.title}`,
    })),
  };
}

export async function getRfqFormClients(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name").order("name");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/views/rfqs.test.ts`
Expected: PASS (8 tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/views/rfqs.ts lib/views/rfqs.test.ts
git commit -m "feat(rfq): view layer + pure display-helper tests"
```

---

### Task 3: Server actions

**Files:**
- Create: `app/(admin)/admin/rfqs/actions.ts`

- [ ] **Step 1: Write the actions module**

Create `app/(admin)/admin/rfqs/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { RFQ_STATUS_LABEL, type RfqStatus } from "@/lib/views/rfqs";

const STATUSES: RfqStatus[] = ["new", "sourcing", "quoted", "won", "lost"];

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

async function logEvent(
  supabase: SupabaseClient,
  rfqId: string,
  kind: "created" | "status" | "quote_linked" | "note",
  body: string | null,
  actorId: string,
) {
  await supabase.from("rfq_events").insert({ rfq_id: rfqId, kind, body, posted_by_profile_id: actorId });
}

export async function createRfq(formData: FormData) {
  const me = await staff();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title is required");
  const clientId = String(formData.get("client_id") ?? "") || null;
  const clientName = clientId ? null : String(formData.get("client_name") ?? "").trim() || null;
  const requestedBy = String(formData.get("requested_by") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const neededBy = String(formData.get("needed_by") ?? "") || null;
  const sourcingNote = String(formData.get("sourcing_note") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: rfq, error } = await supabase
    .from("rfqs")
    .insert({
      title,
      client_id: clientId,
      client_name: clientName,
      requested_by: requestedBy,
      description,
      needed_by: neededBy,
      sourcing_note: sourcingNote,
      owner_profile_id: me.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await logEvent(supabase, rfq.id, "created", null, me.id);
  revalidatePath("/admin/rfqs");
  redirect(`/admin/rfqs/${rfq.id}`);
}

/** Move stage. `note` becomes the sourcing note (when sourcing) or lost reason (when lost). */
export async function setRfqStatus(rfqId: string, status: RfqStatus, note: string | null) {
  const me = await staff();
  if (!STATUSES.includes(status)) throw new Error("invalid status");
  const supabase = await createClient();
  const { data: rfq } = await supabase.from("rfqs").select("status").eq("id", rfqId).maybeSingle();
  if (!rfq) throw new Error("rfq not found");

  const closing = status === "won" || status === "lost";
  const wasClosed = rfq.status === "won" || rfq.status === "lost";
  const patch: {
    status: RfqStatus;
    sourcing_note: string | null;
    lost_reason: string | null;
    updated_at: string;
    closed_at?: string | null;
  } = {
    status,
    sourcing_note: status === "sourcing" ? note?.trim() || null : null,
    lost_reason: status === "lost" ? note?.trim() || null : null,
    updated_at: new Date().toISOString(),
  };
  if (closing && !wasClosed) patch.closed_at = new Date().toISOString();
  if (!closing && wasClosed) patch.closed_at = null;

  await supabase.from("rfqs").update(patch).eq("id", rfqId);
  await logEvent(supabase, rfqId, "status", `→ ${RFQ_STATUS_LABEL[status]}`, me.id);
  revalidatePath("/admin/rfqs");
  revalidatePath(`/admin/rfqs/${rfqId}`);
}

/** Attach an existing client quote → advance to Quoted. */
export async function linkQuote(rfqId: string, quoteId: string) {
  const me = await staff();
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("quote_number").eq("id", quoteId).maybeSingle();
  if (!q) throw new Error("quote not found");
  await supabase
    .from("rfqs")
    .update({ quote_id: quoteId, status: "quoted", updated_at: new Date().toISOString() })
    .eq("id", rfqId);
  await logEvent(supabase, rfqId, "quote_linked", q.quote_number, me.id);
  revalidatePath("/admin/rfqs");
  revalidatePath(`/admin/rfqs/${rfqId}`);
}

export async function saveRfqDetails(formData: FormData) {
  await staff();
  const id = String(formData.get("rfq_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("rfqs")
    .update({
      requested_by: String(formData.get("requested_by") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      needed_by: String(formData.get("needed_by") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(`/admin/rfqs/${id}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `SupabaseClient` import errors, confirm `@supabase/supabase-js` is a dependency — it backs `lib/supabase/server`; it is.)

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/rfqs/actions.ts"
git commit -m "feat(rfq): server actions (create, status, link-quote, details)"
```

---

### Task 4: Board page + New-RFQ dialog

**Files:**
- Create: `app/(admin)/admin/rfqs/page.tsx`
- Create: `app/(admin)/admin/rfqs/NewRfqDialog.tsx`

- [ ] **Step 1: Write the New-RFQ dialog**

Create `app/(admin)/admin/rfqs/NewRfqDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createRfq } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function NewRfqDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [hasClient, setHasClient] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + New RFQ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">New RFQ</h2>
            <p className="mt-1 text-[13px] text-muted">A request that came in — from a customer or your team.</p>
            <form action={createRfq} className="mt-4 space-y-3.5">
              <label className="block">
                <span className={LABEL}>Title</span>
                <input name="title" required autoFocus placeholder="e.g. 10× Dell Micro PCs" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Client (optional)</span>
                <select
                  name="client_id"
                  defaultValue=""
                  onChange={(e) => setHasClient(!!e.target.value)}
                  className={FIELD}
                >
                  <option value="">No client / prospect</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {!hasClient && (
                <label className="block">
                  <span className={LABEL}>…or prospect name</span>
                  <input name="client_name" placeholder="e.g. Acme (not yet a client)" className={FIELD} />
                </label>
              )}
              <label className="block">
                <span className={LABEL}>Requested by</span>
                <input name="requested_by" placeholder="customer contact or team member" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>What they want</span>
                <textarea name="description" rows={3} className={FIELD} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Needed by (optional)</span>
                  <input name="needed_by" type="date" className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}>Waiting on (optional)</span>
                  <input name="sourcing_note" placeholder="e.g. Jurumani" className={FIELD} />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
                >
                  Cancel
                </button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create RFQ"}
    </button>
  );
}
```

- [ ] **Step 2: Write the board page**

Create `app/(admin)/admin/rfqs/page.tsx`:

```tsx
import Link from "next/link";
import {
  getRfqBoard,
  getRfqFormClients,
  BOARD_STATUSES,
  RFQ_STATUS_LABEL,
  type RfqStatus,
  type RfqCard,
  type CardTag,
} from "@/lib/views/rfqs";
import { PageHeader } from "@/components/ui";
import { NewRfqDialog } from "./NewRfqDialog";

const DOT: Record<RfqStatus, string> = {
  new: "#94A3B8",
  sourcing: "#B45309",
  quoted: "#185FA5",
  won: "#15803D",
  lost: "#94A3B8",
};

const TAG_CLASS: Record<CardTag["tone"], string> = {
  warn: "bg-warn-tint text-warn-ink",
  info: "bg-line-soft text-ink-3",
  good: "bg-[#E9F7EF] text-good",
};

export default async function AdminRfqsPage() {
  const [cards, clients] = await Promise.all([getRfqBoard(), getRfqFormClients()]);
  const lost = cards.filter((c) => c.status === "lost");

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="RFQs" subtitle="Incoming quote requests across all clients." />
        <NewRfqDialog clients={clients} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATUSES.map((s) => {
          const col = cards.filter((c) => c.status === s);
          return (
            <div key={s} className="rounded-xl border border-line bg-[#FCFCFD] p-2.5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: DOT[s] }} />
                <span className="text-[12.5px] font-semibold text-ink">{RFQ_STATUS_LABEL[s]}</span>
                <span className="ml-auto text-[11px] text-faint">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((c) => (
                  <RfqCardView key={c.id} card={c} />
                ))}
                {col.length === 0 && <div className="px-1 py-6 text-center text-xs text-faint">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>

      {lost.length > 0 && (
        <details className="rounded-xl border border-line bg-[#FCFCFD] p-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-2">
            Lost / cancelled <span className="text-faint">({lost.length})</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {lost.map((c) => (
              <RfqCardView key={c.id} card={c} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RfqCardView({ card }: { card: RfqCard }) {
  return (
    <Link
      href={`/admin/rfqs/${card.id}`}
      className={`block rounded-lg border border-line bg-card p-3 transition-colors hover:border-faint ${card.status === "lost" ? "opacity-75" : ""}`}
    >
      <div className="text-[13px] font-semibold leading-snug text-ink">{card.title}</div>
      <div className="mt-0.5 truncate text-xs text-muted">
        {card.clientLabel}
        {card.requestedBy && <span className="text-faint"> · from {card.requestedBy}</span>}
      </div>
      {card.tag && (
        <div className="mt-2.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${TAG_CLASS[card.tag.tone]}`}>{card.tag.text}</span>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles; `/admin/rfqs` appears in the route list. (Detail route comes in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/rfqs/page.tsx" "app/(admin)/admin/rfqs/NewRfqDialog.tsx"
git commit -m "feat(rfq): board page + new-RFQ dialog"
```

---

### Task 5: Detail page — status control, link-quote, details form, activity

**Files:**
- Create: `app/(admin)/admin/rfqs/[id]/RfqStatusControl.tsx`
- Create: `app/(admin)/admin/rfqs/[id]/LinkQuote.tsx`
- Create: `app/(admin)/admin/rfqs/[id]/page.tsx`

- [ ] **Step 1: Write the status control**

Create `app/(admin)/admin/rfqs/[id]/RfqStatusControl.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRfqStatus } from "../actions";
import type { RfqStatus } from "@/lib/views/rfqs";

const STAGES: [RfqStatus, string][] = [
  ["new", "New"],
  ["sourcing", "Sourcing"],
  ["quoted", "Quoted"],
  ["won", "Won"],
];

export function RfqStatusControl({
  rfqId,
  status,
  sourcingNote,
  lostReason,
}: {
  rfqId: string;
  status: RfqStatus;
  sourcingNote: string | null;
  lostReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(status === "lost" ? lostReason ?? "" : sourcingNote ?? "");

  const move = (s: RfqStatus, withNote: string | null) =>
    start(async () => {
      await setRfqStatus(rfqId, s, withNote);
      router.refresh();
    });

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {STAGES.map(([s, label]) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => move(s, s === "sourcing" ? note : null)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
              status === s ? "bg-ink text-white" : "border border-line text-ink-2 hover:bg-line-soft"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => move("lost", note)}
          className={`ml-auto text-[12px] ${status === "lost" ? "font-semibold text-brand" : "text-faint hover:text-brand"} disabled:opacity-60`}
        >
          {status === "lost" ? "Lost" : "Mark lost"}
        </button>
      </div>

      {(status === "sourcing" || status === "lost") && (
        <div className="mt-3 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={status === "sourcing" ? "Waiting on? (e.g. Jurumani costing)" : "Why lost? (optional)"}
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => move(status, note)}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the link-quote control**

Create `app/(admin)/admin/rfqs/[id]/LinkQuote.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkQuote } from "../actions";
import type { QuoteOption } from "@/lib/views/rfqs";

export function LinkQuote({
  rfqId,
  clientId,
  quoteId,
  quoteNumber,
  linkableQuotes,
}: {
  rfqId: string;
  clientId: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  linkableQuotes: QuoteOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");

  if (quoteId) {
    return (
      <div className="px-4 py-3.5 text-[13px]">
        <span className="text-muted">Linked quote: </span>
        <Link href={`/admin/quotes/${quoteId}`} className="font-semibold text-brand hover:text-brand-dark">
          {quoteNumber ?? "view"}
        </Link>
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="px-4 py-3.5 text-[13px] text-faint">
        Set a client on this RFQ to link one of their quotes.
      </div>
    );
  }

  if (linkableQuotes.length === 0) {
    return (
      <div className="px-4 py-3.5 text-[13px] text-faint">
        No quotes for this client yet — create one, then link it here.
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-4 py-3.5">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
      >
        <option value="">Choose a quote…</option>
        {linkableQuotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !pick}
        onClick={() =>
          start(async () => {
            await linkQuote(rfqId, pick);
            router.refresh();
          })
        }
        className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60"
      >
        {pending ? "Linking…" : "Link"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the detail page**

Create `app/(admin)/admin/rfqs/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { getRfqDetail, type RfqEvent } from "@/lib/views/rfqs";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { saveRfqDetails } from "../actions";
import { RfqStatusControl } from "./RfqStatusControl";
import { LinkQuote } from "./LinkQuote";

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";
const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);
const KIND_LABEL: Record<string, string> = { created: "Created", status: "Stage change", quote_linked: "Quote linked", note: "Note" };

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rfq = await getRfqDetail(id);
  if (!rfq) {
    return (
      <p className="text-muted">
        RFQ not found. <Link href="/admin/rfqs" className="text-brand hover:text-brand-dark">← RFQs</Link>
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/rfqs" className="hover:text-ink">
            ← RFQs
          </Link>
        }
        title={rfq.title}
        subtitle={
          <span>
            {rfq.clientLabel}
            {rfq.requestedBy && <span className="text-faint"> · from {rfq.requestedBy}</span>}
          </span>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <RfqStatusControl rfqId={rfq.id} status={rfq.status} sourcingNote={rfq.sourcingNote} lostReason={rfq.lostReason} />

          <Card>
            <CardHeader title="Request" />
            <form action={saveRfqDetails} className="space-y-3 px-4 py-4">
              <input type="hidden" name="rfq_id" value={rfq.id} />
              <label className="block">
                <span className={LABEL}>Requested by</span>
                <input name="requested_by" defaultValue={rfq.requestedBy ?? ""} className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>What they want</span>
                <textarea name="description" rows={4} defaultValue={rfq.description ?? ""} className={FIELD} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Needed by</span>
                  <input name="needed_by" type="date" defaultValue={rfq.neededBy ?? ""} className={FIELD} />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>Internal notes</span>
                <textarea name="notes" rows={2} defaultValue={rfq.notes ?? ""} placeholder="Never shown to the client." className={FIELD} />
              </label>
              <div className="flex justify-end">
                <button className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
                  Save
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4 lg:w-[340px] lg:shrink-0">
          <Card>
            <CardHeader title="Quote" />
            <LinkQuote
              rfqId={rfq.id}
              clientId={rfq.clientId}
              quoteId={rfq.quoteId}
              quoteNumber={rfq.quoteNumber}
              linkableQuotes={rfq.linkableQuotes}
            />
          </Card>

          <Card>
            <CardHeader title="Activity" count={rfq.events.length} />
            {rfq.events.length === 0 ? (
              <div className="px-4 py-4 text-xs text-faint">No activity yet.</div>
            ) : (
              rfq.events.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: RfqEvent }) {
  return (
    <div className="border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{KIND_LABEL[e.kind] ?? e.kind}</span>
        {e.body && <span className="text-[13px] text-ink-2">{e.body}</span>}
        <span className="ml-auto text-xs text-faint">{fmtTs(e.createdAt)}</span>
      </div>
      {e.author && <div className="mt-0.5 text-xs capitalize text-faint">{e.author}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles; both `/admin/rfqs` and `/admin/rfqs/[id]` are in the route list.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/rfqs/[id]"
git commit -m "feat(rfq): detail page — status, link-quote, details, activity"
```

---

### Task 6: Navigation + end-to-end verification

**Files:**
- Modify: `lib/nav.ts`

- [ ] **Step 1: Add the nav entry**

In `lib/nav.ts`, in the `rocking_staff` array's **Business** group, add RFQs as the **first** item:

```ts
    {
      label: "Business",
      items: [
        { label: "RFQs", href: "/admin/rfqs" },
        { label: "Quotes", href: "/admin/quotes" },
        { label: "Jobs", href: "/admin/jobs" },
        { label: "Suppliers", href: "/admin/suppliers" },
      ],
    },
```

- [ ] **Step 2: Full build + test suite**

Run: `npm run build && npm test`
Expected: build compiles, all tests pass (including `rfqs.test.ts`).

- [ ] **Step 3: Manual end-to-end check**

Start dev (`npm run dev`) and, signed in as staff:
1. Sidebar **Business → RFQs** opens the board (four columns: New, Sourcing, Quoted, Won).
2. **+ New RFQ** → create one with an existing client → lands on its detail, appears in **New**.
3. Status control → **Sourcing**, type a waiting note, **Save** → card tag shows the note (amber).
4. On its detail, **Quote** card → pick one of the client's quotes → **Link** → status flips to **Quoted**, card tag shows the quote number, **Activity** logs "Quote linked".
5. Move to **Won** → card tag goes green; **Activity** logs the stage change.
6. Create a second RFQ with **no client** (prospect name) → **Quote** card reads "Set a client…"; **Mark lost** with a reason → it drops into the collapsible **Lost / cancelled** section.

- [ ] **Step 4: Commit**

```bash
git add lib/nav.ts
git commit -m "feat(rfq): add RFQs to admin Business nav"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** board + 4 stages + lost off-board (Tasks 4, 5); RFQ fields incl. optional-client/prospect + requested_by + needed_by + sourcing_note + notes (Tasks 1, 3, 4, 5); link-quote → Quoted (Tasks 3, 5); activity log (Tasks 1, 3, 5); staff-only RLS (Task 1); placement first in Business (Task 6). Out-of-scope items (self-service intake, auto-generate quote, emails) are intentionally absent. ✓
- **Placeholder scan:** none — every step has full code/commands. ✓
- **Type consistency:** `RfqStatus`, `RfqCard`, `CardTag` (tones `warn|info|good`), `QuoteOption`, `RfqDetail`, `RfqEvent` defined in Task 2 and used unchanged in Tasks 3–5; actions `createRfq`/`setRfqStatus(rfqId,status,note)`/`linkQuote(rfqId,quoteId)`/`saveRfqDetails` signatures match their callers in the dialog, status control, and link-quote components. ✓
- **Note:** `sourcing_note` is edited inline in the status control (when Sourcing), mirroring the proven Jobs `waiting_note` pattern, rather than in the Request form as the spec prose loosely implied — same field, more consistent UX.
