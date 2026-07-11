# Support Packages & Gating — Phase 1 Design

**Date:** 2026-07-14
**Status:** Approved in conversation (Shawn). Phase 1 of 4.

## Purpose

Support today is one undifferentiated email lane into FreeScout: a client we
make nothing on logs a ticket the same way as an SLA client. The portal becomes
the **gate** — every client gets a support experience matched to their package,
with hours tracked and (in a later phase) enforced.

## Decisions (whole programme)

- **Approach: portal-native spine.** The portal owns packages, gating, the
  hours ledger, bookings, and payments. FreeScout and Crisp stay dumb,
  swappable channels — the data lives with us.
- **Packaging is designed here** (nothing pre-existing to model):
  - **Free** — default for every client. Portal/email ticket → FreeScout,
    best-effort, no SLA. Remote/onsite only as paid bookings (Phase 2).
  - **Business Care** — retainer. N support hours/month included, priority
    ticket lane with a first-response SLA, remote work draws from hours.
  - **Partner** — everything in Care plus Crisp live chat (Phase 4), faster
    SLA, onsite at member rates. Natural home for bundled/managed clients.
- **Bundles are framing, not a model.** A Managed IT bundle *includes* a tier
  (usually Partner); it is not a separate species. A per-client **plan label**
  changes how the tier is displayed ("Support is included in your Rocking
  Managed IT plan"), nothing else. A real product-catalog/bundle model is
  explicitly parked.
- **Email stays open as the free lane.** No lockouts, no mail rules; email is
  simply the best-effort channel. Paid tiers get their value in the portal.
- **Time is tracked in the portal, not FreeScout's module.** Staff log time via
  a quick-add in the admin UI. Operational dependency (flagged): enforcement is
  only as real as the team's logging discipline.
- **Payments (Phase 2) via Paystack**, card upfront before a slot is confirmed.
- **Crisp (Phase 4)** is a second inbox — premium channel only, no
  FreeScout sync.

## Phases

1. **This spec:** package model, gated `/support`, admin assignment, time
   ledger + burn-down display.
2. Paid bookings: internal slot picker + Paystack checkout → FreeScout ticket.
3. Enforcement: hours exhausted → meter locks, portal offers paid booking/top-up.
4. Crisp embed for Partner sessions (+ PWA push).

Phases 2–4 get their own spec → plan → build cycles.

---

## Phase 1 data model

Migration (next number at build time):

**`support_packages`** — `id uuid pk`, `key text unique` (`free` |
`business_care` | `partner`), `name text`, `rank int` (0/1/2, for "is this an
upgrade" comparisons), `included_minutes int` (0 for free), `sla_hours int
null` (first-response target; null = best effort), `has_chat bool`,
`remote_included bool`, `is_default bool`. Seeded with the three tiers
(allowance/SLA numbers are data — Shawn sets real values in the admin UI, seeds
use placeholders: free 0/null, care 300 min / 8h, partner 600 min / 4h).

**`clients`** — add `support_package_id uuid null references support_packages`
(null → treat as the default package) and `support_plan_label text null`
(display override, e.g. "Managed IT bundle").

**`support_time_entries`** — `id`, `client_id fk`, `minutes int > 0`,
`work_type text check in ('ticket','remote','onsite','other')`, `note text`,
`freescout_number int null`, `entered_by uuid references profiles`,
`occurred_on date default today`, `created_at`.

Monthly usage = `sum(minutes) where occurred_on in current calendar month` —
computed at read time, no reset job.

### Access rules

- `support_packages`: select for all authenticated; write staff-only.
- `clients.support_package_id` / `support_plan_label`: staff-only writes (an
  RPC or staff-guarded action — clients never set their own tier; NOT
  manager-editable, unlike device disposition).
- `support_time_entries`: staff full access; the client's users may **select**
  their own client's entries (transparency makes the hours meter trustworthy
  at invoice time). RLS mirrors `xero_invoices` (staff OR
  `client_id = current_client_id()`).

## Phase 1 gating — client `/support`

The page resolves the client's package (their row's package, else the default)
and renders per tier:

- **Free:** today's ticket form + history, framed "Standard support — we
  respond as capacity allows", plus an upgrade card naming what Care/Partner
  add ("included in our Managed IT plans"). No hours meter.
- **Business Care:** same ticket surface flagged as priority, plus an hours
  meter — "3h 20m of 5h used this month" — from the time ledger.
- **Partner:** Care experience + a chat slot ("Live chat — coming soon" until
  Phase 4) + faster-SLA copy.
- **Plan label present:** tier name is replaced by "Support is included in
  your {label}" framing.

Portal-created tickets are tagged in FreeScout with the tier (e.g.
`tier:care`) via the existing `lib/freescout.ts` client, so priority is
visible where the team actually works.

Members see the same surface minus the hours meter (manager-level detail).

## Phase 1 admin surfaces

- **`/admin/support-packages`** — list + edit the three packages (name,
  minutes, SLA, flags). Data, not code.
- **Client page** — package selector + plan-label field (staff-only action).
- **Log time** — quick-add (client, minutes, work_type, note, optional
  FreeScout #) on the admin client page; entries list with delete (staff).
- **Burn view** — on the client page: current-month total vs allowance;
  a simple all-clients month table on the packages page (who's over/under).

## Testing

- Vitest on pure logic: usage aggregation (month windowing), package
  resolution (null → default), meter formatting, "is upgrade" rank compare.
- Manual: assign packages to a test client, log time, verify meter + gating
  renders per tier and per role; RLS spot-checks (client reads only own
  entries; member sees no meter; manager cannot write package/tier).

## Out of scope (Phase 1)

Paystack/bookings, enforcement behavior, Crisp, product catalog/bundles,
FreeScout mail rules, migration of existing clients onto paid tiers (all
default to Free; Shawn assigns real tiers by hand).
