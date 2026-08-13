# Quote service layer — design

**Date:** 2026-08-13
**Status:** approved
**Scope:** `lib/quotes/service.ts` — one owner for quote create / amend / send

## Why

Quoting is the busiest workflow in the portal and it has no home in the application. Every quote
this business has issued was created by `scripts/create-quote.mjs` running on Shawn's laptop with
the Supabase **service role key**. That has three consequences:

1. **The team cannot quote at all.** There is no admin UI and no API — only a CLI script.
2. **An agent cannot be given the job safely.** The smallest credential that creates a quote today
   is the service role key plus the Resend key: unrestricted read/write on every client's data, and
   the ability to send mail as any address on the domain.
3. **The rules have drifted.** Four concerns exist in two implementations — totals, booking-link
   minting, the client email, and the `sent_emails` record. `create-quote.mjs` carries the comment
   *"this script can't import the TS helper, so the two write paths must be kept in sync by hand."*
   Adding the accounts@ CC rule on 2026-08-05 required editing four separate places.

That third point is now fixable: Node 22 strips TypeScript natively, proven in this repo on
2026-08-13 when a script imported `lib/onboarding-email.ts` directly. The script can finally share
code with the application — subject to the runtime constraint below.

## Runtime constraint (verified 2026-08-13)

A plain Node script can import a `.ts` module, including a chain of relative `.ts` imports, but
**not** one that carries either of these:

| Blocker | Why | Verified |
| --- | --- | --- |
| `import "server-only"` | The package only resolves inside the Next.js bundler | `lib/email/send.ts` → *Cannot find package 'server-only'* |
| `@/…` path aliases | Node has no tsconfig path resolution | `lib/supabase/service.ts` |

Both `lib/email/send.ts` and `lib/calendly.ts` carry the marker, so the script cannot simply import
them. Shared modules must therefore be **marker-free, relative-import-only, and take their
dependencies as parameters** — chiefly the Supabase client, which is where the `@/` alias enters.
Dependency injection is what makes a module usable from Next, from a CLI, and from a unit test
without mocks. The `server-only` guard stays where it belongs: on the Next-facing wrappers.

## Goals

- One place that owns writing a quote, so a rule change is a one-line change.
- Let the team create quotes (via Claude, later via an admin UI) **without** being able to email a
  client directly.
- Make a scoped API and MCP server thin wrappers over this layer rather than new rule-holders.

## Non-goals

- Decision paths (accept / decline / request changes), checkout, subscriptions and invoicing stay
  exactly where they are. They are single-implementation, UI-driven, and already carry auth and
  atomic-flip guards.
- The service does not validate commercial judgment. Markup, tone and "should we quote this at all"
  remain human rules, documented in the scheduled-task SKILL.md.
- No REST API or MCP server in this project. This is the layer they will sit on.

## Architecture

### Stage 1 — delete the duplication (no new concepts)

Each duplicated concern gets exactly one implementation the script can reach:

| Concern | Today | After |
| --- | --- | --- |
| Totals | copy in the script, hand-synced | import `lib/quotes/doc.ts` → `computeTotals`. Already marker-free and import-free; works as-is. |
| Booking link | copy in the script | extract `lib/quotes/booking-link.ts` — marker-free, takes `(sb, quoteId)`. `lib/calendly.ts` keeps its marker and re-exports. |
| Client email + `sent_emails` | direct `fetch` to Resend, own insert | extract `lib/email/deliver.ts` — marker-free, takes `(sb, opts)`. `lib/email/send.ts` becomes a thin `server-only` wrapper over it. |

Behaviour unchanged, independently shippable. Note the email extraction is genuine work rather than
a one-line import swap, because of the runtime constraint above.

**One thing stage 1 does not change:** quote email is not suppressible. `SUPPRESSIBLE_CATEGORIES`
is an allow-list of `portal_update` and `onboarding_step` only, so routing quotes through the shared
core neither adds nor removes filtering. It does gain them the `sent_emails` record written by the
same code as everything else, instead of a hand-maintained copy.

### Stage 2 — `lib/quotes/service.ts`

Policy only. It composes the modules above; it does not absorb them. Marker-free, with the Supabase
client injected once by a factory so callers don't thread it through every call:

```ts
makeQuoteService(sb: SupabaseClient) → {
  create(input, actor)          → { quoteId, quoteNumber, version, status }
  amend(quoteId, input, actor)  → { version, status }
  send(quoteId, actor)          → { sentTo: string[] }
}
```

Next server actions build it with `createServiceClient()`; the CLI builds it with its own client;
tests build it with a stub. No caller needs `server-only` to reach quoting logic.

### The actor

```ts
type Actor = { id: string | null; label: string; canSend: boolean };
```

`id` is a profile id for a human, null for a machine caller. `label` is what appears in the audit
trail. **`canSend` is asserted by the caller, never chosen by the service.**

| Caller | canSend | Rationale |
| --- | --- | --- |
| Portal action, staff session | true | A human clicked, having seen the rendered quote |
| Shawn's API key / agent session | true | Preserves the existing "send it" workflow |
| Team via Claude, Hermes | false | Programmatic; must be reviewed in the portal first |

Note the permission is a property of the **channel**, not the person: a team member who cannot send
from Claude *can* review that same quote in the portal and click send there.

### The three rules the service enforces

1. **Only `sendQuote` ever sets status `sent`.** `createQuote` and `amendQuote` produce
   `pending_review` (gated callers) or `draft` (callers who can send). No caller can ask for `sent`.
   This follows from create not emailing: a quote marked `sent` that nobody received would be a lie
   told by the status field.
2. **`amendQuote` always pulls a live quote out of `sent`** — to `pending_review` for gated callers,
   to `draft` for everyone else — so the revision is never visible to the client until someone sends
   it. This closes a real back door: on 2026-08-13 amending a sent quote pushed the new version live
   to the client instantly and had to be pulled back by hand.
3. `sendQuote` requires `canSend`, and records the actor on the `sent` event.

The client briefly loses sight of a quote being revised, because `draft` and `pending_review` are
both hidden from clients by RLS. That is correct: a quote mid-revision should not be readable, and
the window is however long it takes to press send.

## Data flow

`createQuote` **never emails the client.** Today create-and-email are one action; splitting them is
what makes the review gate real rather than conventional.

```
createQuote(input, actor)
  ├─ validate: client exists, doc parses, ≥1 priced line, validUntil in the future
  ├─ idempotency: key already seen? → return the existing quote, write nothing
  ├─ assign number: QU-<prefix>-NNN from the client's prefix
  ├─ computeTotals (the same function the rendered document uses)
  ├─ insert quotes + quote_versions + quote_internal
  ├─ events: created, then pending_review | draft per actor.canSend
  └─ if pending_review → notify shawn@ + kelle@ + accounts@ that review is needed

sendQuote(quoteId, actor)
  ├─ require actor.canSend
  ├─ atomic flip → sent (only from pending_review | draft, or a retry — see below)
  ├─ event: sent, with actor
  ├─ ensure single-use booking link
  └─ notifyQuoteSent → client managers, CC shawn@ + accounts@,
     recording resend_message_id (reply threading) + sent_emails

amendQuote(quoteId, input, actor)
  ├─ new quote_versions + quote_internal row
  ├─ status: draft (canSend) | pending_review (gated) — never left at sent
  └─ event with actor
```

## Schema changes

### 1. `quotes.idempotency_key text` — unique where not null

Agents retry. Without this a network wobble produces two quotes. A repeat key returns the original
result rather than creating a second quote. (Real precedent: the duplicate CILSA monitor quote
`Q-2026-002`, deleted 2026-08-11.)

### 2. Per-client numbering

- `clients.quote_prefix text` — e.g. `CIL`, `GSR`, `DST`.
- `quote_prefix_counters (prefix text primary key, last_n int not null default 0)`.
- `next_quote_number(prefix text)`, security definer, replacing the year-keyed
  `next_quote_number()` which returns `Q-YYYY-NNN`.

Every quote to date passed an explicit number and bypassed the counter, which is why the single
quote that did not came out as `Q-2026-002`. Making the convention the default removes that class
of mistake.

**Migration requirement:** seed `quote_prefix_counters` from the highest existing number per prefix
before first use, or a generated `QU-CIL-002` will collide with a quote already issued.

## Error handling

Three kinds of failure, three treatments.

**Validation** — the caller's fault. Return `{ ok: false, error }` rather than throwing, matching
the existing `AdminDecisionResult` shape in the admin actions.

**Conflict** — a race. The atomic flip (`update ... where status = 'pending_review'`) makes the
loser a clean no-op, as `approveAndSendQuote` already does. This is what prevents double-sends.

**Delivery** — currently a dead end, and this design fixes it. `approveAndSendQuote` flips the
quote to `sent` and then sends inside a `try`; when Resend fails the quote reads `sent`, the client
has nothing, and retry is impossible because the status is no longer `pending_review`.

The fix uses data already recorded. `resend_message_id` is written to the `sent` event only once
Resend confirms, so delivery state is knowable:

> `sendQuote` may also run on a quote already marked `sent` whose current version's `sent` event has
> **no** `resend_message_id`. That is a delivery that never confirmed, and retrying is safe.

Flip-first is retained; a failed send stops being terminal.

**Partial writes** — a create is four inserts and is not transactional, so a mid-sequence failure
leaves an orphan quote with no version. `createQuote` compensates: on failure it deletes what it
wrote and returns an error. A single Postgres function doing all four atomically is the stronger
option, rejected here because it moves policy into SQL where it is harder to test, against a small
failure window. Revisit if orphans appear in practice.

## Testing

Follows the split that already works in `lib/subscriptions/`: pure decisions in one module,
exhaustively unit-tested; I/O in another.

**Pure, unit-tested hard** — these functions *are* the policy:

```ts
decideCreateStatus(actor)                → 'pending_review' | 'draft'
decideAmendStatus(actor, currentStatus)  → 'pending_review' | 'draft'
canRetryDelivery(status, sentEvent)      → boolean
```

**Integration tests** against a scratch client, covering the paths that have actually bitten:
idempotent replay, amend-returns-to-review, the send race, and delivery retry.

**Stage 1 verification is a diff, not a test suite.** Generate a quote before and after the
deletion and compare the stored document, totals and rendered email HTML. Byte-identical output is
a stronger claim than passing tests, because the change is meant to alter nothing.

## Sequencing

1. Extract `lib/email/deliver.ts` and `lib/quotes/booking-link.ts`; rewire `send.ts` and
   `quote-emails.ts` to them. No script changes yet.
2. Point `create-quote.mjs` at the shared modules and delete its four private copies. Verified by
   diff, not by tests.
3. Schema: idempotency key, prefix columns, counter table, seeded from existing quotes.
4. `service.ts` with the pure decision functions and their tests.
5. Migrate `approveAndSendQuote` to `service.send` — small and low-stakes.
6. Migrate `create-quote.mjs` to `service.create` / `service.send`.

Each step is separately shippable. Work can stop after any of them.

## Open questions

None blocking. Deferred by choice:

- **Nudges/resends** of an already-delivered quote (the CILSA laptop reminder of 2026-08-05) are out
  of scope; `sendQuote` handles first delivery and retry of a failed one, not re-sending a quote the
  client already has.
- **Client creation** by gated callers is not part of this layer. Quoting a new prospect still needs
  a client record, and duplicate tenants are a demonstrated risk (Nova Nexus, merged 2026-08-11).
  This belongs with the API project, where a search-before-create guard can be enforced.
