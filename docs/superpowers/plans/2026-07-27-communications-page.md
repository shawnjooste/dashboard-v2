# Client Communications Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/communications` shows clients every email the portal has sent them, backed by a single send chokepoint so the history has no gaps.

**Architecture:** One `lib/email/send.ts` replaces three duplicate `sendEmail` copies; it POSTs to Resend and records a `sent_emails` row (recipients, subject, HTML, category, audience). RLS scopes client reads: managers see all client-audience mail for their company, members only mail addressed to them. The client page renders stored HTML in a sandboxed iframe.

**Tech Stack:** Next.js 16 (server components), Supabase Postgres/RLS, Resend, vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-communications-page-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; verify `cat supabase/.temp/project-ref` before any push. Commands from repo root.
- Migration number **0060** — verify still free at build time (`ls supabase/migrations` AND `npx supabase migration list --linked`); parallel sessions are active.
- **The refactor must not change observable email behaviour.** Two traps, both verified in the current code:
  1. **FROM differs per sender.** `lib/quote-emails.ts` sends as `'"Rocky @ Rocking" <quotes@send.rocking.one>'`; `lib/notify.ts` and `lib/job-emails.ts` send as `'"Rocking" <no-reply@send.rocking.one>'`. `quotes@` is the address wired to the inbound-reply webhook — changing it silently breaks quote reply threading. The shared helper takes a per-call `from`.
  2. **`notifyQuoteSent` uses the returned message id.** It stores `` `<${id}@send.rocking.one>` `` on `quotes.resend_message_id` for inbound threading. The shared helper returns the raw Resend id; the caller keeps formatting it exactly as today.
- Logging is best-effort everywhere: a failed `sent_emails` insert is console-logged and swallowed — never block or fail an email that has already been sent.
- `bcc` is never written to `to_emails` (blind copies stay blind). `to` + `cc` are recorded.
- Internal mail (`audience: "internal"`) must be unreachable by clients via RLS, not merely hidden in the UI.
- Client page renders stored HTML **only** in a sandboxed iframe (`sandbox` without `allow-scripts`), never `dangerouslySetInnerHTML`.
- Quote parenthesized paths in shell. Stale `.next/* 2.*` files break tsc — `find .next -name "* 2.*" -delete` if it complains.

---

### Task 1: Pure helpers + tests (TDD)

**Files:**
- Create: `lib/communications-helpers.ts`
- Test: `lib/communications-helpers.test.ts`

**Interfaces (produced — Task 5 imports these):**
- `CATEGORY_LABELS: Record<string, string>` — `onboarding`→"Welcome", `booking`→"Booking", `quote`→"Quote", `job`→"Job update", `admin_alert`→"Internal", `general`→"General"
- `categoryLabel(category: string): string` — falls back to the raw key when unknown
- `formatRecipients(emails: string[]): string` — joins with ", "; past 3 shows the first 3 then " +N more"; empty → "—"

- [ ] **Step 1: Write the failing test**

`lib/communications-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryLabel, formatRecipients } from "./communications-helpers";

describe("categoryLabel", () => {
  it("labels known categories", () => {
    expect(categoryLabel("onboarding")).toBe("Welcome");
    expect(categoryLabel("quote")).toBe("Quote");
    expect(categoryLabel("job")).toBe("Job update");
  });
  it("falls back to the raw key for unknown categories", () => {
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("formatRecipients", () => {
  it("joins a short list", () => {
    expect(formatRecipients(["a@x.com", "b@x.com"])).toBe("a@x.com, b@x.com");
  });
  it("truncates past three", () => {
    expect(formatRecipients(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"])).toBe(
      "a@x.com, b@x.com, c@x.com +2 more",
    );
  });
  it("handles exactly three without truncating", () => {
    expect(formatRecipients(["a@x.com", "b@x.com", "c@x.com"])).toBe("a@x.com, b@x.com, c@x.com");
  });
  it("handles an empty list", () => {
    expect(formatRecipients([])).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/communications-helpers.test.ts`
Expected: FAIL — cannot find module `./communications-helpers`.

- [ ] **Step 3: Implement**

`lib/communications-helpers.ts`:

```ts
/** Pure display helpers for the communications page — no server imports
 *  (vitest-safe). */

export const CATEGORY_LABELS: Record<string, string> = {
  onboarding: "Welcome",
  booking: "Booking",
  quote: "Quote",
  job: "Job update",
  admin_alert: "Internal",
  general: "General",
};

/** Friendly label for a category, falling back to the raw key so a new
 *  category added by a future sender still renders sensibly. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** "a@x.com, b@x.com, c@x.com +2 more" — keeps long recipient lists readable. */
export function formatRecipients(emails: string[]): string {
  if (emails.length === 0) return "—";
  if (emails.length <= 3) return emails.join(", ");
  return `${emails.slice(0, 3).join(", ")} +${emails.length - 3} more`;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run lib/communications-helpers.test.ts` → 6 pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/communications-helpers.ts lib/communications-helpers.test.ts
git commit -m "feat(comms): pure category/recipient display helpers"
```

---

### Task 2: Migration — `sent_emails`, `current_user_email()`, RLS

**Files:**
- Create: `supabase/migrations/0060_sent_emails.sql`
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces: table `public.sent_emails`; function `public.current_user_email()`. Tasks 3–6 read/write these.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0060_sent_emails.sql`:

```sql
-- Every email the portal sends, so clients can read their own correspondence
-- history at /communications and staff have one source of truth. Written only
-- by the send chokepoint (lib/email/send.ts) and scripts/create-quote.mjs,
-- both service-role — clients never write here.
create table public.sent_emails (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references public.clients(id) on delete cascade,
  to_emails           text[] not null,
  subject             text not null,
  html                text not null,
  -- Open set (onboarding | booking | quote | job | admin_alert | general):
  -- no check constraint, so a new sender never needs a migration.
  category            text not null default 'general',
  -- 'internal' = addressed to Rocking about a client (signup alerts, staff
  -- job assignments). Never visible to clients — enforced in RLS below.
  audience            text not null default 'client'
                        check (audience in ('client','internal')),
  resend_id           text,
  sent_by_profile_id  uuid references public.profiles(id) on delete set null,
  sent_at             timestamptz not null default now()
);
create index sent_emails_client_at_idx on public.sent_emails (client_id, sent_at desc);
-- Member scoping filters on array containment (to_emails @> ARRAY[...]).
create index sent_emails_to_idx on public.sent_emails using gin (to_emails);

-- The caller's own email, lowercased. SECURITY DEFINER so the lookup isn't
-- itself subject to profiles RLS; mirrors current_client_id()/is_rocking_staff().
create or replace function public.current_user_email()
returns text
language sql stable security definer set search_path = public
as $$
  select lower(email) from public.profiles where id = auth.uid();
$$;
grant execute on function public.current_user_email() to authenticated;

alter table public.sent_emails enable row level security;

create policy sent_emails_staff on public.sent_emails
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients read their own client-audience mail: managers see everything sent to
-- their company, members only what was addressed to them. No client write
-- policy of any kind.
create policy sent_emails_client_read on public.sent_emails
  for select using (
    audience = 'client'
    and client_id = public.current_client_id()
    and (
      public.current_user_role() = 'client_manager'
      or public.current_user_email() = any(to_emails)
    )
  );
```

- [ ] **Step 2: Push (verify ref and number first)**

Run: `cat supabase/.temp/project-ref` → must print `eskhokedsximnslgsycs`; `ls supabase/migrations | tail -3` → confirm 0060 is free. Then `npx supabase db push --linked`.
Expected: "Applying migration 0060_sent_emails.sql... Finished".

- [ ] **Step 3: Regenerate types + typecheck**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts` then `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: `sent_emails` present in the types; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0060_sent_emails.sql lib/types/database.ts
git commit -m "feat(comms): sent_emails table, current_user_email helper, RLS"
```

---

### Task 3: The shared send chokepoint

**Files:**
- Create: `lib/email/send.ts`

**Interfaces:**
- Consumes: `sent_emails` (Task 2); `createServiceClient` from `@/lib/supabase/service`.
- Produces: `sendEmail(opts): Promise<{ id: string | null }>` with the exact options block below. Task 4 rewires all three senders onto it.

- [ ] **Step 1: Write the helper**

`lib/email/send.ts`:

```ts
// The one door every portal email goes through: sends via Resend, then
// records the message in sent_emails so /communications and the admin
// activity feed have a complete history. If you add a new email anywhere,
// call THIS — a send that bypasses it is invisible to the client's history.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export const DEFAULT_FROM = '"Rocking" <no-reply@send.rocking.one>';

export type SendEmailOptions = {
  to: string[];
  subject: string;
  html: string;
  /** Overrides DEFAULT_FROM. Quote mail sends as quotes@ (the inbound-reply
   *  address) — changing a sender's from-address breaks reply threading. */
  from?: string;
  cc?: string[];
  /** Blind copies are never recorded on the client-visible row. */
  bcc?: string[];
  replyTo?: string;
  clientId?: string | null;
  /** onboarding | booking | quote | job | admin_alert | general */
  category?: string;
  /** "internal" = addressed to Rocking about a client; hidden from clients. */
  audience?: "client" | "internal";
  sentByProfileId?: string | null;
};

/** Sends the email and records it. Returns Resend's raw message id (callers
 *  that need a threading header format it themselves), or null when the send
 *  was skipped for want of an API key. Throws only if Resend rejects the send;
 *  a logging failure never propagates. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return { id: null };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from ?? DEFAULT_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      ...(opts.bcc?.length ? { bcc: opts.bcc } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
  const sent = await res.json().catch(() => ({}) as { id?: string });
  const id: string | null = sent?.id ?? null;

  // Record it. Best-effort: the email is already gone, so a logging failure
  // must never surface to the caller.
  try {
    await createServiceClient()
      .from("sent_emails")
      .insert({
        client_id: opts.clientId ?? null,
        to_emails: [...opts.to, ...(opts.cc ?? [])],
        subject: opts.subject,
        html: opts.html,
        category: opts.category ?? "general",
        audience: opts.audience ?? "client",
        resend_id: id,
        sent_by_profile_id: opts.sentByProfileId ?? null,
      });
  } catch (e) {
    console.error("sent_emails log failed:", e);
  }
  return { id };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/email/send.ts
git commit -m "feat(comms): single send chokepoint that records every email"
```

---

### Task 4: Rewire the three senders (behaviour-preserving)

**Files:**
- Modify: `lib/notify.ts` (delete its local `sendEmail`, call the shared one)
- Modify: `lib/quote-emails.ts` (same; keep the quotes@ FROM and message-id formatting)
- Modify: `lib/job-emails.ts` (same; keep BCC behaviour)

**Interfaces:**
- Consumes: `sendEmail` from `@/lib/email/send` (Task 3).

- [ ] **Step 1: Rewire `lib/notify.ts`**

Delete the local `async function sendEmail(...)` entirely (including its `portal_activity` insert — Task 6 makes `sent_emails` the single source). Add `import { sendEmail } from "@/lib/email/send";` and update each call site to the new shape, keeping every existing recipient/subject/body untouched:

- `notifyPendingSignup` → `await sendEmail({ to: [ADMIN_EMAIL], subject, html, category: "admin_alert", audience: "internal", clientId: null })`
- `sendOnboardingEmail` → `await sendEmail({ to: [opts.to], subject: \`Welcome to The Portal — ${opts.companyName}\`, html: onboardingEmailHtml(opts), replyTo: SUPPORT_EMAIL, category: "onboarding", audience: "client", clientId: opts.clientId ?? null })`
- `sendBookingConfirmation` → same pattern with `category: "booking"`, `audience: "client"`, and its existing `clientId`
- `notifyFirstSignIn` → `category: "admin_alert"`, `audience: "internal"`, keeping its existing `clientId`

The local `FROM` constant in `notify.ts` is now unused — delete it (the shared `DEFAULT_FROM` is the same address).

- [ ] **Step 2: Rewire `lib/quote-emails.ts`**

Delete its local `sendEmail`. Add `import { sendEmail } from "@/lib/email/send";`. Keep the file's `FROM` constant and pass it on every call — quote mail must keep sending as `quotes@send.rocking.one`:

```ts
const { id } = await sendEmail({
  to,
  cc,
  subject,
  html,
  from: FROM,
  category: "quote",
  audience: "client",
  clientId: opts.clientId,
});
```

For `notifyQuoteSent`, preserve the threading format exactly as today:

```ts
const messageId = id ? `<${id}@send.rocking.one>` : null;
```

then the existing `if (messageId) { … update quotes.resend_message_id … }` block is unchanged.

The reviewer/admin-facing quote emails in this file (the ones going to `REVIEWERS`/`ADMIN_EMAIL` rather than client managers) pass `audience: "internal"`; the manager-facing ones pass `audience: "client"`.

- [ ] **Step 3: Rewire `lib/job-emails.ts`**

Delete its local `sendEmail`. Add `import { sendEmail } from "@/lib/email/send";`. Each call becomes:

```ts
await sendEmail({ to, subject, html, bcc, category: "job", audience: "client", clientId: opts.clientId });
```

Except `notifyTaskAssigned`, which emails a staff assignee — that one passes `audience: "internal"`. BCC keeps working and, per the constraint, is not recorded in `to_emails`.

- [ ] **Step 4: Verify nothing else sends mail directly**

Run: `grep -rn "api.resend.com" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v ".next"`
Expected: exactly one hit — `lib/email/send.ts`. (`scripts/create-quote.mjs` is a `.mjs` script and is handled in Task 7; `app/api/webhooks/resend-inbound/route.ts` calls Resend's *receiving* API to fetch an inbound message, not to send — it should not appear in this grep's `emails` POST usage, and must not be changed.)

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/notify.ts lib/quote-emails.ts lib/job-emails.ts
git commit -m "refactor(comms): route every sender through the shared chokepoint"
```

---

### Task 5: The client page + nav

**Files:**
- Create: `lib/views/communications.ts`
- Create: `app/(app)/communications/page.tsx`
- Modify: `lib/nav.ts` (add "Communications" for `client_manager` and `client_member`)

**Interfaces:**
- Consumes: `sent_emails` (Task 2); `categoryLabel`, `formatRecipients` (Task 1).
- Produces: `type SentEmailRow = { id, subject, toEmails, category, sentAt, html }`; `getMyCommunications(): Promise<SentEmailRow[]>`.

- [ ] **Step 1: View layer**

`lib/views/communications.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type SentEmailRow = {
  id: string;
  subject: string;
  toEmails: string[];
  category: string;
  sentAt: string;
  html: string;
};

/** Emails the signed-in user is allowed to see, newest first. All scoping —
 *  client, audience, and manager-vs-member — is enforced by RLS on
 *  sent_emails, not here. */
export async function getMyCommunications(): Promise<SentEmailRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sent_emails")
    .select("id, subject, to_emails, category, sent_at, html")
    .order("sent_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id,
    subject: e.subject,
    toEmails: e.to_emails ?? [],
    category: e.category,
    sentAt: e.sent_at,
    html: e.html,
  }));
}
```

- [ ] **Step 2: The page**

`app/(app)/communications/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getMyCommunications } from "@/lib/views/communications";
import { categoryLabel, formatRecipients } from "@/lib/communications-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const fmtDate = (ts: string) => ts.slice(0, 10);

export default async function CommunicationsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");

  const emails = await getMyCommunications();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        subtitle="Every email we've sent you, in one place — invites, quotes, bookings and updates."
      />

      {emails.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">
            Nothing yet — emails we send you will appear here.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Emails" count={emails.length} />
          {emails.map((e) => (
            <details key={e.id} className="border-b border-line-soft last:border-0">
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-4 py-3 hover:bg-canvas">
                <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
                  {categoryLabel(e.category)}
                </span>
                <span className="min-w-0 text-sm font-medium text-ink">{e.subject}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-faint">{fmtDate(e.sentAt)}</span>
              </summary>
              <div className="px-4 pb-4">
                <p className="mb-2 text-xs text-muted">To: {formatRecipients(e.toEmails)}</p>
                {/* Stored HTML is rendered in a sandboxed frame — never injected
                    into this document — so a templated email can't script the portal. */}
                <iframe
                  title={e.subject}
                  sandbox=""
                  srcDoc={e.html}
                  className="h-[520px] w-full rounded-lg border border-line bg-white"
                />
              </div>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Nav**

In `lib/nav.ts`, add to the `client_manager` **Account** group (after "Team"):

```ts
        { label: "Communications", href: "/communications" },
```

and to the `client_member` nav — inside its existing services group, after "Support":

```ts
        { label: "Communications", href: "/communications" },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean; `/communications` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add lib/views/communications.ts "app/(app)/communications/page.tsx" lib/nav.ts
git commit -m "feat(comms): client communications page + sidebar link"
```

---

### Task 6: Activity feed reads `sent_emails`

**Files:**
- Modify: `lib/views/activity.ts` (email rows come from `sent_emails`, not `portal_activity`)

**Interfaces:**
- Consumes: `sent_emails` (Task 2).

- [ ] **Step 1: Swap the source**

In `lib/views/activity.ts`: add `sent_emails` to the parallel query block —

```ts
      supabase.from("sent_emails").select("sent_at, client_id, subject, to_emails, category, audience").gte("sent_at", since).order("sent_at", { ascending: false }).limit(CAP),
```

— name its result `sentEmails`, delete the `a.kind === "email"` branch from the `portal_activity` loop (those rows stop being written by Task 4), and add:

```ts
  for (const e of sentEmails.data ?? []) {
    push({
      at: e.sent_at,
      group: "emails",
      actor: null,
      clientId: e.client_id,
      clientName: named(e.client_id),
      text: `${e.category} email${e.audience === "internal" ? " (internal)" : ""} sent: “${e.subject}” → ${(e.to_emails ?? []).join(", ")}`,
    });
  }
```

Add `sentEmails` to the `capped` check array alongside the other sources.

- [ ] **Step 2: Build**

Run: `npm run build` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/views/activity.ts
git commit -m "refactor(comms): activity feed reads sent_emails as the single source"
```

---

### Task 7: Quote script + verification + push

**Files:**
- Modify: `scripts/create-quote.mjs` (write a `sent_emails` row instead of `portal_activity`)

- [ ] **Step 1: Update the script's logging**

In `scripts/create-quote.mjs`, replace the existing `portal_activity` insert in the email block with:

```js
  if (res.ok) {
    // Mirrors lib/email/send.ts — this script can't import the TS helper, so
    // the two write paths must be kept in sync by hand.
    await sb.from("sent_emails").insert({
      client_id: clientId,
      to_emails: to,
      subject: `${heading}: ${title}`,
      html,
      category: "quote",
      audience: "client",
    }).then(({ error }) => { if (error) console.error("sent_emails log failed:", error.message); });
  }
```

(The email HTML is already in a local variable in that block; if it is inlined in the fetch body, hoist it to `const html = \`…\`` first so both the send and the log use the same string.)

- [ ] **Step 2: Full suite + build**

Run: `npm test && npm run build` → both green.

- [ ] **Step 3: Live RLS verification with real JWTs**

Write a throwaway script (same method as the feature-access verification) that, using the service role: inserts three `sent_emails` rows for one real client — (a) `audience:'client'` to `manager@…`, (b) `audience:'client'` to `member@…`, (c) `audience:'internal'` to `shawn@rocking.one`; creates two throwaway auth users on that client (one `client_manager`, one `client_member` whose email matches row b); signs each in via the password grant with the ANON key; then asserts with each real JWT:
- manager sees rows a and b, **not** c;
- member sees **only** row b;
- a user on a different client sees none;
- anon sees none.
Delete the test users and rows afterwards. Any deviation is a blocker.

- [ ] **Step 4: Send a real email end to end**

Trigger one genuine client-audience email (e.g. re-send an onboarding email to your own address via the admin invite flow, or run the quote script against a test quote with `--no-email` removed) and confirm: it arrives in the inbox as before, `sent_emails` has the row, and it renders correctly on `/communications`.

- [ ] **Step 5: Adversarial review**

Dispatch a reviewer over the full diff focused on: the refactor changing observable behaviour (FROM addresses per sender, message-id threading, BCC still applied but never recorded, every previous call site's recipients/subject preserved), `audience` correctly assigned on every call site (an internal email leaking to a client page is the worst failure here), RLS correctness for manager/member/other-client/anon, and the iframe sandbox. Fix Critical/Important findings, then re-review.

- [ ] **Step 6: Push**

Push to `main`; after deploy, health-check `/communications` (307 → login when unauthenticated).
