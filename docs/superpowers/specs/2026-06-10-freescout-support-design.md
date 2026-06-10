# FreeScout Support (Live Proxy) — Design

**Date:** 2026-06-10
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Existing client users already raise tickets in FreeScout (`https://help.rocking.co.za`) via the
old dashboard. v2 must keep support continuity, so FreeScout comes back as the support channel
(Crisp deferred indefinitely). Verified against the live API: conversations filter by
`customerEmail`, list rows embed `customer.email`, `?embed=threads` returns full threads, and the
portal mailbox is **#1 "Email Support"** (support@rocking.co.za). Existing users' history keys off
their email, so it appears in v2 with zero migration (e.g. shawn@rocking.one → 28 tickets).

## Approach

**Thin live proxy — FreeScout is the single source of truth.** No mirror tables, no sync, no
webhooks (deliberate departure from the old dashboard's mirrored design). A server-only module
calls the FreeScout REST API with the API key from env (`FREESCOUT_URL`, `FREESCOUT_API_KEY` —
already in `.env.local`; must also be set on Vercel). The key never reaches the browser.

**Authorization is ours, not FreeScout's.** The API key is staff-level, so every server entry
point enforces scope before proxying:
- **member** — may only list/view/reply-to conversations whose `customer.email` equals their
  login email.
- **manager** — additionally conversations whose customer-email domain is in their client's
  `client_domains`.
- **staff** — don't use this surface; the admin sidebar links out to FreeScout itself
  (no agent console rebuild).

## DB change (one small migration)

`client_domains` is currently staff-only RLS (Plan 2 carry-forward anticipated this). Migration
`0014_client_domains_member_read.sql` adds a SELECT policy: client users may read their **own**
client's domain rows (`client_id = public.current_client_id()`). Needed for the manager filter;
harmless for members.

## Server module — `lib/freescout.ts` (server-only)

- `listConversationsByEmail(email)` — GET `/api/conversations?customerEmail=&status=all`,
  sorted by `updatedAt` desc.
- `listRecentConversationsForDomains(domains)` — GET recent conversations (one page, 100, sorted
  `updatedAt` desc) filtered in-code by customer-email domain. v1 limitation (most recent 100)
  documented in code.
- `getConversation(id)` — GET `/api/conversations/{id}?embed=threads`; returns subject, status,
  customer, and customer/message threads (drops `lineitem` system rows).
- `createTicket({ email, subject, message })` — POST `/api/conversations` with `type: "email"`,
  `mailboxId: 1`, `customer: { email }`, one `customer` thread.
- `replyToTicket(id, email, message)` — POST `/api/conversations/{id}/threads` with
  `type: "customer"`, `customer: { email }`.
- Plus a `getSupportScope()` helper in the same file: resolves the caller's profile → their email
  and (managers) their client's domains; used by every page/action for authorization.

## UI

Sidebar (`lib/nav.ts`):
- member: + **Support** `/support`
- manager: + **Support** `/support`
- staff: + **Support** → external `https://help.rocking.co.za` (Sidebar renders `http(s)` hrefs
  as plain `<a target="_blank">`, never active-highlighted).

Pages (all in `(app)`, inheriting the client gate):
1. **`/support`** — ticket list: subject, status badge (active→Open, pending→Pending,
   closed→Closed), last-updated; member sees own, manager sees own + company (deduped). "New
   ticket" button. Empty state.
2. **`/support/new`** — subject + message form → server action `createTicket` as the caller's
   email → redirect to the new ticket.
3. **`/support/[id]`** — thread view (customer vs staff messages styled differently, HTML bodies
   rendered sanitized-as-text v1: strip tags to text to avoid XSS from email HTML) + reply
   textarea → server action `replyToTicket` (re-checks scope) → refresh.

## Error handling

- FreeScout unreachable / non-200 → pages render a "Support is temporarily unavailable" message
  (no crash); actions return an error state.
- Detail/reply on an out-of-scope or unknown conversation → 404-style "ticket not found" (no
  information leak about other customers' tickets).
- Email HTML bodies are converted to plain text before rendering (no `dangerouslySetInnerHTML`).

## Out of scope (v1)

Attachments, AI summaries/embeddings/digest, Telegram, agent console, ticket fields beyond
subject/message, pagination beyond first pages, Crisp.

## Testing

`npm run build` / `tsc` / `lint` + a scope unit test for the pure email-domain filter; live
walkthrough with shawn@rocking.one's existing tickets. Vercel env vars must be added
(`FREESCOUT_URL`, `FREESCOUT_API_KEY`) before the deployed app works.

## Files

- Create: `supabase/migrations/0014_client_domains_member_read.sql`, `lib/freescout.ts`,
  `lib/freescout-scope.ts` (pure filter helpers + tests), `app/(app)/support/page.tsx`,
  `app/(app)/support/new/page.tsx`, `app/(app)/support/[id]/page.tsx`,
  `app/(app)/support/actions.ts`
- Modify: `lib/nav.ts`, `components/Sidebar.tsx` (external links)
