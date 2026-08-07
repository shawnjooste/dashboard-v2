# Agreements — Design

**Date:** 2026-08-06
**Status:** Approved in conversation (Shawn).

## Purpose

Rocking sends a lot of client agreements. Today they live outside the portal
as documents emailed around and signed by hand or not at all. This puts them
in the portal: staff write an agreement for a client, the client's manager
reads it inline and signs it electronically, and both sides get a permanent
record — with a downloadable PDF that carries evidence of the signature.

The agreement always stays on the portal; the PDF is a copy, not the record.

## Decisions

- **Signature = typed name + explicit intent tick.** The signer types their
  full name and ticks "I agree to these terms and intend this as my
  signature", and we capture name, email, profile, timestamp, IP and user
  agent. Under South Africa's ECT Act this is an ordinary electronic
  signature, which is valid for ordinary commercial agreements. (Suretyships,
  property transfers and wills need an accredited *advanced* signature — this
  feature is explicitly not for those, and the UI must not imply otherwise.)
  Not legal advice; Shawn's call, recorded here so it isn't relitigated.
- **Bespoke per client — no templates.** One agreement, one client. If the
  same text goes to several clients it is written per client. A template layer
  was considered and rejected as premature.
- **Body is markdown, authored in the portal** (or handed over in chat and
  pasted in). No file uploads: the portal renders the agreement, which gives
  inline reading, and a deterministic PDF. Uploading existing PDFs/Word docs
  is out of scope.
- **Any active `client_manager` of that client may sign.** Not a nominated
  individual — that creates a dead end when the named person leaves or is
  away. Whoever signs is recorded by name and email.
- **Client signature only; Rocking does not counter-sign.** Issuing the
  agreement is Rocking's side of it. The PDF names Rocking as issuer.
- **Frozen after signing.** `body_md` cannot change once `status = 'signed'`
  — enforced in the action *and* by a database trigger. An agreement whose
  text can change after signature is worthless as evidence. Changing terms
  means issuing a new agreement.
- **The PDF is generated once, at signing, and stored.** Not regenerated on
  demand: the file we can produce years later must be byte-identical to what
  the client downloaded, not a re-render from whatever the code looks like
  then.

## Data model

Migration `0083_agreements.sql` (verify the number is still free at build —
parallel sessions; check `ls supabase/migrations` **and**
`npx supabase migration list --linked`).

`public.agreements`
- `id uuid pk default gen_random_uuid()`
- `client_id uuid not null references clients on delete cascade`
- `reference text not null unique` — human-quotable, e.g. `AGR-2026-014`,
  allocated on insert by a `next_agreement_reference()` counter function
  following the `next_quote_number()` precedent
- `title text not null`
- `body_md text not null`
- `status text not null default 'draft'`
  check in (`draft`, `sent`, `signed`, `void`)
- `created_by_profile_id uuid references profiles on delete set null`
- `sent_at timestamptz`
- Signature: `signed_at timestamptz`, `signed_by_profile_id uuid references
  profiles on delete set null`, `signer_name text`, `signer_email text`,
  `signer_ip text`, `signer_user_agent text`
- `pdf_path text` — object path in the `agreement-pdfs` bucket
- `void_reason text`, `created_at`, `updated_at`
- Indexes: `(client_id, created_at desc)`, `(status)`

**Freeze trigger:** a `before update` trigger raises if `body_md`, `title` or
any signature column changes while the existing row's `status = 'signed'`.
Belt and braces with the action guard — the app must not be the only thing
standing between a signed agreement and an edit.

**Storage:** private bucket `agreement-pdfs` (`public = false`), objects at
`{client_id}/{agreement_id}.pdf`, served only via short-lived signed URLs
generated server-side. Same pattern as `device-photos`.

### RLS

- Staff: full access (`is_rocking_staff()`).
- Client read: `client_id = current_client_id()` **and** `status <> 'draft'`
  **and** `current_user_role() = 'client_manager'` **and**
  `has_feature('agreements')`. Members never see agreements — only managers
  sign. Drafts are never client-visible.
- No client write path at all: signing goes through a `SECURITY DEFINER` RPC
  (below), never a direct update.

### Signing RPC

`sign_agreement(p_agreement_id uuid, p_signer_name text, p_ip text, p_user_agent text)`
— `SECURITY DEFINER`, `search_path = public`. Validates that the caller is an
active `client_manager` of the agreement's client, that
`status = 'sent'`, and that `p_signer_name` is non-empty after trimming; then
atomically sets `status = 'signed'` with the signature columns, returning the
row only if it actually transitioned. A losing concurrent click gets nothing
back, mirroring the quote-decision pattern, so two managers cannot both
"sign" the same agreement.

The RPC does **not** write `pdf_path` — the server action generates the PDF
after the transition succeeds and patches the path in via the service client.
Ordering matters: the signature is the legal event, the PDF is a artefact of
it, so a PDF failure must never lose or block a valid signature.

## Feature access

Add `agreements` to `FEATURES` in `lib/feature-access.ts` (currently
`connectivity, billing, quotes, team, devices, m365, network`), with the nav
href `/agreements`. Manager default on, member default off, per-user override
available — consistent with billing and quotes, and enforced in RLS via
`has_feature('agreements')` as above.

## PDF generation

`lib/agreements/markdown-blocks.ts` — **pure and vitest-covered**, no
imports. `markdownToBlocks(md: string): Block[]` where
`Block = { kind: 'h1'|'h2'|'h3'|'p'|'bullet'|'number'; text: string; runs:
{ text: string; bold: boolean }[] }`. Supported subset, deliberately small
because these are agreements not brochures: `#`/`##`/`###` headings,
paragraphs, `-`/`*` bullets, `1.` numbered lists, `**bold**`, and blank-line
paragraph breaks. Anything else renders as plain paragraph text rather than
throwing — an unsupported character must never block a signature.

`lib/agreements/pdf.ts` — server-only. Takes the agreement row plus blocks
and draws with **pdf-lib** (new dependency; the only one this feature adds),
A4, Helvetica, with pagination and a running footer of
`{reference} · page n of m`. After the body it appends a **signature
certificate**:

> Signed electronically on {date, SAST} by {signer_name} ({signer_email}) for
> {client name}. Issued by Rocking (Pty) Ltd. Reference {reference}. IP
> {ip}. This agreement was signed in the Rocking client portal and the
> authoritative record is held there.

## Surfaces

**Staff — `/admin/agreements`** (nav: Business group)
- List: reference, client, title, status pill, sent/signed dates. Filter by
  status and client.
- `/admin/agreements/new` — client picker, title, markdown body with a live
  rendered preview beside it. Saves as `draft`.
- `/admin/agreements/[id]` — draft: edit and preview; **Send** (sets `sent`,
  emails the client's managers). Sent: awaiting-signature state, with
  **Void** (with a reason). Signed: read-only, the signature record, and a
  download of the stored PDF.

**Client — `/agreements`** (nav: Account group, managers only)
- List of their agreements: title, status, signed date, download when signed.
- `/agreements/[id]` — the agreement rendered inline, and either the signing
  block (typed name + intent tick + Sign) or, once signed, a confirmation
  banner naming who signed and when, plus Download PDF.

**Markdown rendering** uses the same `markdownToBlocks()` output rendered as
JSX — one parser feeding both screen and PDF, so what the client reads is
provably what they sign. No markdown React dependency, and no raw HTML is
ever rendered from the body.

**Email:** on send, the client's managers get a branded notification with a
link (through the existing `sendEmail` chokepoint in `lib/notify.ts`, so it
lands in the activity feed automatically). On signing, Shawn is notified.

## Testing

- Vitest on `markdownToBlocks`: each supported element, bold runs inside
  paragraphs and list items, blank-line handling, unsupported syntax
  degrading to plain text, empty input.
- Vitest on the reference formatter.
- Live verification before push: create a draft against a throwaway client,
  send it, sign it as a manager, confirm the PDF downloads and its content
  matches the on-screen agreement; confirm a second signing attempt fails;
  confirm the freeze trigger rejects an edit to a signed row; confirm a
  member and a different client's manager both get zero rows via a real JWT.
- Adversarial review before push — this touches evidence and access control.

## Out of scope

Templates or reusable clause libraries; multiple signatories; Rocking
counter-signature; chaser/reminder emails; uploading existing PDF or Word
documents; drawn/canvas signatures; public tokenised signing links for people
without a portal login (noted as the likely next step if an external
signatory is ever needed); versioning or amendment of a signed agreement
(supersede by issuing a new one).
