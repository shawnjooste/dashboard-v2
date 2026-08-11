# Portal Update Opt-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can switch off Portal Update emails — in their own Communications page or by staff on the admin users list — and the send chokepoint refuses to deliver Portal Updates to them, while every transactional email still goes.

**Architecture:** One pure suppression module decides who gets filtered; `lib/email/send.ts` (the single door every portal email goes through) applies it, so no send path can bypass the preference. One boolean column on `profiles`. Two thin UI toggles over one guarded action.

**Tech Stack:** Next.js 16 server components/actions, Supabase Postgres/RLS, Resend, vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-portal-update-optout-design.md`

## Global Constraints

- **Only `category === "portal_update"` is ever suppressed.** Quotes, bookings, agreements, job updates, onboarding/sign-in links, company-detail changes and internal alerts always send. The suppressible set is an explicit allow-list of one; anything added later is deliverable unless deliberately added to that set.
- `cc`/`bcc` are never filtered — they carry internal copies (accounts@, support@).
- When every `to` recipient is suppressed: do **not** call Resend and do **not** write `sent_emails`.
- Migration number **0085** (verify still free: `ls supabase/migrations` AND `npx supabase migration list --linked` — parallel sessions work this repo).
- Supabase ref `eskhokedsximnslgsycs`. Commands from repo root.
- Pure logic lives in an import-free module with vitest; vitest must never import `@/lib/supabase/server`.
- `sendEmail`'s return type gains `suppressed` — existing callers destructure `{ id }` only (verified: `lib/quote-emails.ts:24`), so this is backward-compatible. Do not change any caller.
- Stale `.next/* 2.*` files break `npx tsc --noEmit` → `find .next -name "* 2.*" -delete`.
- Local dev reads `.env.local` and therefore talks to **production** Supabase — use throwaway records for live tests and delete them.

---

### Task 1: Suppression logic + tests (TDD)

**Files:**
- Create: `lib/email/suppression.ts`
- Test: `lib/email/suppression.test.ts`

**Interfaces (produced — Task 3 imports these):**
- `SUPPRESSIBLE_CATEGORIES: ReadonlySet<string>` — contains exactly `"portal_update"`
- `isSuppressible(category: string | undefined): boolean`
- `splitRecipients(to: string[], category: string | undefined, optedOut: Set<string>): { send: string[]; suppressed: string[] }` — `optedOut` holds lowercased addresses; matching is case-insensitive; a non-suppressible category returns every address in `send`; inputs are never mutated.

- [ ] **Step 1: Write the failing test**

`lib/email/suppression.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSuppressible, splitRecipients, SUPPRESSIBLE_CATEGORIES } from "./suppression";

const optedOut = new Set(["gavin@keller.education"]);

describe("SUPPRESSIBLE_CATEGORIES", () => {
  it("contains portal_update and nothing else", () => {
    expect([...SUPPRESSIBLE_CATEGORIES]).toEqual(["portal_update"]);
  });
});

describe("isSuppressible", () => {
  it("is true only for portal_update", () => {
    expect(isSuppressible("portal_update")).toBe(true);
    for (const c of ["quote", "booking", "onboarding", "job", "admin_alert", "general", undefined]) {
      expect(isSuppressible(c)).toBe(false);
    }
  });
});

describe("splitRecipients", () => {
  it("never filters a transactional category, even for an opted-out address", () => {
    const out = splitRecipients(["gavin@keller.education"], "quote", optedOut);
    expect(out.send).toEqual(["gavin@keller.education"]);
    expect(out.suppressed).toEqual([]);
  });

  it("drops opted-out addresses from a portal update", () => {
    const out = splitRecipients(["a@x.com", "gavin@keller.education"], "portal_update", optedOut);
    expect(out.send).toEqual(["a@x.com"]);
    expect(out.suppressed).toEqual(["gavin@keller.education"]);
  });

  it("matches addresses case-insensitively", () => {
    const out = splitRecipients(["GAVIN@Keller.Education"], "portal_update", optedOut);
    expect(out.send).toEqual([]);
    expect(out.suppressed).toEqual(["GAVIN@Keller.Education"]);
  });

  it("returns an empty send list when everyone opted out", () => {
    const out = splitRecipients(["gavin@keller.education"], "portal_update", optedOut);
    expect(out.send).toEqual([]);
  });

  it("handles an undefined category and an empty opt-out set", () => {
    const out = splitRecipients(["a@x.com"], undefined, new Set());
    expect(out.send).toEqual(["a@x.com"]);
  });

  it("does not mutate its inputs", () => {
    const to = ["a@x.com", "gavin@keller.education"];
    const set = new Set(["gavin@keller.education"]);
    splitRecipients(to, "portal_update", set);
    expect(to).toEqual(["a@x.com", "gavin@keller.education"]);
    expect([...set]).toEqual(["gavin@keller.education"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/email/suppression.test.ts`
Expected: FAIL — cannot find module `./suppression`.

- [ ] **Step 3: Implement**

`lib/email/suppression.ts`:

```ts
/** Which portal email a person may switch off — and who gets filtered out.
 *  Pure, no server imports (vitest-safe).
 *
 *  SAFETY: this is an allow-list of ONE. Everything the portal sends is
 *  transactional — a quote, a booking, an agreement, a sign-in link — and must
 *  reach its recipient regardless of preferences. Only announcements
 *  ("portal_update") are suppressible. A category added later is deliverable
 *  unless someone deliberately adds it here, and that should take a good
 *  argument. */
export const SUPPRESSIBLE_CATEGORIES: ReadonlySet<string> = new Set(["portal_update"]);

export function isSuppressible(category: string | undefined): boolean {
  return category !== undefined && SUPPRESSIBLE_CATEGORIES.has(category);
}

/** Split a recipient list into who to send to and who opted out. `optedOut`
 *  holds lowercased addresses; comparison is case-insensitive. */
export function splitRecipients(
  to: string[],
  category: string | undefined,
  optedOut: Set<string>,
): { send: string[]; suppressed: string[] } {
  if (!isSuppressible(category) || optedOut.size === 0) return { send: [...to], suppressed: [] };
  const send: string[] = [];
  const suppressed: string[] = [];
  for (const address of to) {
    (optedOut.has(address.trim().toLowerCase()) ? suppressed : send).push(address);
  }
  return { send, suppressed };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/email/suppression.test.ts` → 8 pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/email/suppression.ts lib/email/suppression.test.ts
git commit -m "feat(email): suppression rules for portal updates"
```

---

### Task 2: Migration — the preference column

**Files:**
- Create: `supabase/migrations/0085_portal_update_optout.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

`supabase/migrations/0085_portal_update_optout.sql`:

```sql
-- Portal Updates are the portal's only non-transactional email (announcements
-- about new features). This is the one switch that turns them off, per person.
-- Everything else the portal sends — quotes, bookings, agreements, job updates,
-- sign-in links — ignores this column entirely and always sends. Enforcement
-- lives in lib/email/send.ts, gated on category = 'portal_update'.
alter table public.profiles
  add column portal_updates_opt_out boolean not null default false;
```

- [ ] **Step 2: Push (verify the ref and the number first)**

Run: `cat supabase/.temp/project-ref` → must print `eskhokedsximnslgsycs`.
Run: `npx supabase db push --linked`
Expected: "Applying migration 0085_portal_update_optout.sql... Finished".

- [ ] **Step 3: Regenerate types + typecheck**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts`
Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: `portal_updates_opt_out` present in the types; typecheck clean. (If `lib/auth/profile.ts` builds a fallback profile object literal, add `portal_updates_opt_out: false` to it.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0085_portal_update_optout.sql lib/types/database.ts
git commit -m "feat(email): portal_updates_opt_out preference column"
```

---

### Task 3: Enforce it in the send chokepoint + the footer

**Files:**
- Create: `lib/email/portal-update-footer.ts`
- Modify: `lib/email/send.ts`

**Interfaces:**
- Consumes: `isSuppressible`, `splitRecipients` (Task 1); the `profiles.portal_updates_opt_out` column (Task 2).
- Produces: `sendEmail()` returns `{ id: string | null; suppressed: string[] }`; `portalUpdateFooterHtml(): string`.

- [ ] **Step 1: Write the footer helper**

`lib/email/portal-update-footer.ts`:

```ts
/** The opt-out line appended to Portal Updates — and to nothing else. An
 *  opt-out is only meaningful if the people receiving the mail can find it. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

export function portalUpdateFooterHtml(): string {
  return `
    <div style="margin-top:28px; padding-top:14px; border-top:1px solid #E5E5E5; font-family:-apple-system,Segoe UI,Roboto,sans-serif; font-size:12px; color:#8A8A8E;">
      You're getting this because you use the Rocking portal.
      <a href="${APP_URL}/communications" style="color:#8A8A8E;">Turn off portal updates</a>.
    </div>`;
}
```

- [ ] **Step 2: Apply suppression + footer in `lib/email/send.ts`**

Add the imports at the top of the file:

```ts
import { isSuppressible, splitRecipients } from "@/lib/email/suppression";
import { portalUpdateFooterHtml } from "@/lib/email/portal-update-footer";
```

Change the return type on the JSDoc'd signature to
`Promise<{ id: string | null; suppressed: string[] }>`, and replace the body
from the `const key = ...` line down to the Resend `fetch` call with:

```ts
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return { id: null, suppressed: [] };
  }

  // Honour Portal Update opt-outs here, at the one door every email goes
  // through — a hand-written script that forgets to filter still cannot reach
  // someone who switched these off. Transactional mail is never filtered.
  let to = opts.to;
  let suppressed: string[] = [];
  if (isSuppressible(opts.category)) {
    const lowered = opts.to.map((e) => e.trim().toLowerCase());
    const { data: outRows } = await createServiceClient()
      .from("profiles")
      .select("email")
      .eq("portal_updates_opt_out", true)
      .in("email", lowered);
    const optedOut = new Set((outRows ?? []).map((r) => r.email.trim().toLowerCase()));
    ({ send: to, suppressed } = splitRecipients(opts.to, opts.category, optedOut));
    // Everyone opted out: nothing was sent, so record nothing. A sent_emails
    // row here would show up in a client's history for mail they never got.
    if (to.length === 0) return { id: null, suppressed };
  }

  const html = isSuppressible(opts.category) ? opts.html + portalUpdateFooterHtml() : opts.html;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from ?? DEFAULT_FROM,
      to,
      subject: opts.subject,
      html,
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      ...(opts.bcc?.length ? { bcc: opts.bcc } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
```

Then in the recording block change the recipient line so the stored row
reflects who was actually mailed:

```ts
        to_emails: [...to, ...(opts.cc ?? [])].map((e) => e.trim().toLowerCase()),
```

and both remaining `return { id }` statements become `return { id, suppressed }`.

- [ ] **Step 3: Typecheck**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: clean. (`lib/quote-emails.ts` destructures `{ id }` only, so it is unaffected.)

- [ ] **Step 4: Commit**

```bash
git add lib/email/send.ts lib/email/portal-update-footer.ts
git commit -m "feat(email): honour portal update opt-outs at the send chokepoint"
```

---

### Task 4: The preference action, recipient helper, and both toggles

**Files:**
- Create: `lib/actions/email-preferences.ts`
- Create: `lib/views/portal-updates.ts`
- Create: `components/PortalUpdatesToggle.tsx`
- Modify: `app/(app)/communications/page.tsx`
- Modify: `lib/views/people.ts` (carry the flag to the admin users list)
- Modify: `app/(admin)/admin/users/UsersView.tsx` (render the toggle)

**Interfaces:**
- Produces: `setPortalUpdateOptOut(profileId: string, optOut: boolean): Promise<void>`; `getPortalUpdateRecipients(clientId?: string): Promise<{ eligible: Recipient[]; optedOut: Recipient[] }>` where `type Recipient = { email: string; name: string; clientName: string }`; `<PortalUpdatesToggle profileId optedOut label? />`.

- [ ] **Step 1: The guarded action**

`lib/actions/email-preferences.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

/** Turn Portal Updates on or off for one person. Staff may set it for any
 *  client user; anyone else may only set their own. Never affects
 *  transactional email — see lib/email/suppression.ts. */
export async function setPortalUpdateOptOut(profileId: string, optOut: boolean) {
  const me = await getCurrentProfile();
  if (!me.authenticated) throw new Error("not signed in");
  const isStaff = me.profile.role === "rocking_staff";
  if (!isStaff && profileId !== me.profile.id) {
    throw new Error("you can only change your own email preferences");
  }
  const service = createServiceClient();
  let q = service.from("profiles").update({ portal_updates_opt_out: optOut }).eq("id", profileId);
  // A client-surface caller may only ever touch their own row; staff may not
  // flip this on a rocking_staff profile from here either.
  if (!isStaff) q = q.eq("id", me.profile.id);
  else q = q.in("role", ["client_manager", "client_member"]);
  const { error } = await q;
  if (error) throw new Error(error.message);
  revalidatePath("/communications");
  revalidatePath("/admin/users");
}
```

- [ ] **Step 2: The recipient helper**

`lib/views/portal-updates.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type Recipient = { email: string; name: string; clientName: string };

/** Who would receive a Portal Update, and who has switched them off.
 *  Staff-only by RLS. For previewing a send — the guarantee that opted-out
 *  people are excluded lives in lib/email/send.ts, not here. */
export async function getPortalUpdateRecipients(
  clientId?: string,
): Promise<{ eligible: Recipient[]; optedOut: Recipient[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("profiles")
    .select("email, client_id, portal_updates_opt_out, people(display_name)")
    .eq("status", "active")
    .in("role", ["client_manager", "client_member"]);
  if (clientId) q = q.eq("client_id", clientId);
  const [{ data, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const eligible: Recipient[] = [];
  const optedOut: Recipient[] = [];
  for (const r of data ?? []) {
    const person = Array.isArray(r.people) ? r.people[0] : r.people;
    const row: Recipient = {
      email: r.email,
      name: (person as { display_name?: string } | null)?.display_name ?? r.email,
      clientName: r.client_id ? (clientName.get(r.client_id) ?? "—") : "—",
    };
    (r.portal_updates_opt_out ? optedOut : eligible).push(row);
  }
  const byName = (a: Recipient, b: Recipient) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name);
  return { eligible: eligible.sort(byName), optedOut: optedOut.sort(byName) };
}
```

- [ ] **Step 3: The shared toggle component**

`components/PortalUpdatesToggle.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { setPortalUpdateOptOut } from "@/lib/actions/email-preferences";

/** Checkbox reading "send me these", stored as opt-OUT. Saves on change; the
 *  box reverts if the save fails so it never shows a preference we didn't
 *  persist. */
export function PortalUpdatesToggle({
  profileId,
  optedOut,
  label = "Send me portal updates",
}: {
  profileId: string;
  optedOut: boolean;
  label?: string;
}) {
  const [on, setOn] = useState(!optedOut);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const change = (next: boolean) => {
    setOn(next);
    setErr(null);
    start(async () => {
      try {
        await setPortalUpdateOptOut(profileId, !next);
      } catch (e) {
        setOn(!next);
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => change(e.target.checked)} />
        {label}
      </label>
      {err && <span className="text-[12px] text-brand">{err}</span>}
    </span>
  );
}
```

- [ ] **Step 4: Card on the Communications page**

In `app/(app)/communications/page.tsx`, add the import
`import { PortalUpdatesToggle } from "@/components/PortalUpdatesToggle";`
and insert this Card directly after the `<PageHeader …/>`:

```tsx
      <Card>
        <CardHeader title="Portal updates" />
        <div className="px-4 py-3.5">
          <PortalUpdatesToggle
            profileId={me.profile.id}
            optedOut={me.profile.portal_updates_opt_out}
          />
          <p className="mt-2 text-[13px] text-muted">
            Occasional news about new portal features. Quotes, bookings and support emails are
            always sent.
          </p>
        </div>
      </Card>
```

- [ ] **Step 5: Carry the flag to the admin users list**

In `lib/views/people.ts`: add `portalUpdatesOptOut: boolean;` to the
`GlobalPersonRow` type; add `portal_updates_opt_out` to the `profilesQ`
select (the one selecting `id, person_id, role, status, feature_overrides`);
and in the row mapping add `portalUpdatesOptOut: !!prof?.portal_updates_opt_out,`.

- [ ] **Step 6: Toggle on the admin users list**

In `app/(admin)/admin/users/UsersView.tsx` add
`import { PortalUpdatesToggle } from "@/components/PortalUpdatesToggle";`
and render it beside the existing `<AccessEditor person={p} />`, only for
people with a portal profile:

```tsx
                {p.profileId && (
                  <PortalUpdatesToggle
                    profileId={p.profileId}
                    optedOut={p.portalUpdatesOptOut}
                    label="Updates"
                  />
                )}
```

- [ ] **Step 7: Build**

Run: `npm test && npm run build`
Expected: suite green; build compiles.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/email-preferences.ts lib/views/portal-updates.ts components/PortalUpdatesToggle.tsx "app/(app)/communications/page.tsx" lib/views/people.ts "app/(admin)/admin/users/UsersView.tsx"
git commit -m "feat(email): portal update toggles for clients and staff"
```

---

### Task 5: Live verification + push

- [ ] **Step 1:** `npm test && npm run build` — both green.

- [ ] **Step 2: prove the safety rule holds, against production, with a throwaway address.**
  Write a temporary `.mts` script run with `npx tsx` that:
  1. creates a throwaway auth user `optout-test@rocking-internal.test`, sets its profile to an existing test company as `client_member`, `status = 'active'`, `portal_updates_opt_out = true`;
  2. calls the real `sendEmail` from `lib/email/send.ts` with `category: "portal_update"`, `to: ["optout-test@rocking-internal.test", "shawn@rocking.one"]` — asserts `suppressed` contains only the test address, and that the written `sent_emails.to_emails` contains `shawn@rocking.one` and **not** the test address;
  3. calls `sendEmail` again with `category: "quote"` to the same opted-out address — asserts it **was** sent (`suppressed` empty, a `sent_emails` row exists). This is the rule that matters: opting out of updates never blocks a quote;
  4. calls `sendEmail` with `category: "portal_update"` addressed **only** to the opted-out address — asserts `id` is null and that **no** `sent_emails` row was written;
  5. deletes the throwaway auth user and any `sent_emails` rows the test created.
  Print each assertion's result. Every assertion must pass before pushing.

- [ ] **Step 3:** Push to `main`; after deploy, health-check `/communications` and `/admin/users` (both 307 → login when unauthenticated).

- [ ] **Step 4:** Tell Shawn the operational change: to send a Portal Update, the send must pass `category: "portal_update"` — that is the flag that both applies the opt-out and adds the footer. Anything sent under another category will reach everyone.
