# Client Communications Page — Design

**Date:** 2026-07-27
**Status:** Approved in conversation (Shawn) — Approach A.

## Purpose

Clients can read every email the portal has sent them, in the portal. Today
those emails exist only in the recipient's inbox; Rocking has no shared record
beyond a subject line in the staff activity feed. `/communications` becomes the
correspondence history for managers and members alike.

## Decisions

- **One shared send helper is the whole point.** Three private copies of
  `sendEmail` exist today (`lib/notify.ts`, `lib/quote-emails.ts`,
  `lib/job-emails.ts`) and only `notify.ts` logs anything. A history with
  silent gaps is worse than no history, so every send funnels through a single
  `lib/email/send.ts` that POSTs to Resend **and** records the row.
- **Visibility:** managers see every client-audience email sent to anyone at
  their company; members see only emails addressed to them. Prevents a member
  reading quote/billing correspondence meant for management while still giving
  managers the full record.
- **Store and render the real email** (HTML as sent), so "what did that invite
  actually say?" is answerable without digging through an inbox.
- **Internal mail never reaches the client page.** Emails addressed to Rocking
  about a client (pending-signup alerts, first-sign-in notices, staff job
  assignments) are recorded with `audience = 'internal'` and are excluded from
  client reads by RLS, not merely hidden in the UI.
- **One source of truth.** The admin activity feed switches its email rows to
  read `sent_emails` instead of `portal_activity`, so the two logs cannot
  drift. `sendEmail`'s existing `portal_activity` email insert is removed.

## Data

Migration `0060_sent_emails.sql` (verify 0060 is still free at build time —
parallel sessions are active):

- `sent_emails`: `id uuid pk`, `client_id uuid null references clients on
  delete cascade`, `to_emails text[] not null`, `subject text not null`,
  `html text not null`, `category text not null` (`onboarding` | `booking` |
  `quote` | `job` | `admin_alert` | `general` — open set, no check constraint
  so new categories never need a migration), `audience text not null default
  'client' check (audience in ('client','internal'))`, `resend_id text`,
  `sent_by_profile_id uuid null references profiles on delete set null`,
  `sent_at timestamptz not null default now()`.
- Indexes: `(client_id, sent_at desc)`; GIN on `to_emails` (member scoping
  filters on array containment).
- New helper `current_user_email()` — SECURITY DEFINER, `search_path = public`,
  returns `lower(email)` from `profiles` for `auth.uid()`; mirrors the existing
  `current_client_id()` / `is_rocking_staff()` helpers in `0003_auth_helpers.sql`.
- RLS:
  - staff: `for all using (is_rocking_staff()) with check (is_rocking_staff())`
  - client read: `for select using (audience = 'client' and client_id =
    current_client_id() and (current_user_role() = 'client_manager' or
    current_user_email() = any(to_emails)))`
  - no client insert/update/delete policy at all — writes are service-role only.

## The send chokepoint

`lib/email/send.ts` exports:

```
sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  clientId?: string | null;
  category: string;
  audience?: "client" | "internal";   // default "client"
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  sentByProfileId?: string | null;
}): Promise<{ id: string | null }>
```

It POSTs to Resend, then inserts the `sent_emails` row via the service client.
**Logging is best-effort**: a failed insert is logged to the console and
swallowed — it must never prevent an email that has already been sent, nor
fail a caller's flow. `to`/`cc` are recorded in `to_emails` (the addressed
humans); `bcc` is deliberately NOT recorded on the client-visible row, since
blind copies are blind.

`lib/notify.ts`, `lib/quote-emails.ts`, `lib/job-emails.ts` delete their local
`sendEmail` and call this one, passing the right `category`/`audience`:
`notifyPendingSignup` and `notifyFirstSignIn` → `audience: "internal"`; staff
job-assignment mail → `internal`; onboarding, booking confirmations, quote and
client-facing job mail → `client`.

`scripts/create-quote.mjs` is a standalone Node script and cannot import the TS
helper; it writes its own `sent_emails` row directly (service role). This is
the one duplicated write path and is called out in a comment in both files so
the pair stays in sync.

## Client page

`/communications` (client route group), guarded like the other client pages:

- List, newest first: subject, sent date, recipients, category badge. Empty
  state: "Nothing yet — emails we send you will appear here."
- Row expands (or links to `/communications/[id]`) to show the email: subject,
  date, to-line, then the stored HTML rendered in a **sandboxed iframe**
  (`sandbox` with no `allow-scripts`, `srcDoc` set to the stored html). Stored
  HTML is portal-authored, but rendering it via `dangerouslySetInnerHTML`
  inside the app's DOM would be a needless XSS surface if a future email ever
  templates in client-supplied text.
- Sidebar: "Communications" in the **Account** group for `client_manager` and
  in the member nav for `client_member`.

## Admin side

No new admin page. `lib/views/activity.ts` swaps its email source from
`portal_activity` (kind `email`) to `sent_emails`, gaining real recipient and
category data in the existing feed.

## Testing

- Vitest on pure helpers: recipient-list formatting (`"a@x.com, b@x.com"`,
  truncated past 3 with "+N more") and category labelling.
- Live RLS verification with real JWTs, the same method used for the
  feature-access work: a manager sees client-audience rows for their client
  and zero internal rows; a member sees only rows containing their address; a
  user from another client sees nothing.
- Manual: send a real onboarding email to a test address, confirm it appears
  on `/communications` with the body rendering correctly.

## Out of scope

Delivery/open/bounce tracking (the `resend_id` is stored so Resend webhooks
could add it later), backfill of emails sent before this ships (no bodies
exist to backfill), client-side composing or replying, inbound email
(`inbound_emails` already exists for quotes@ and is unrelated), attachments,
and any admin-side communications page.
