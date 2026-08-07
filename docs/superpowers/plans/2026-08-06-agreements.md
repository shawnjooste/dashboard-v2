# Agreements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff write a markdown agreement for a client; the client's manager reads it inline and signs it electronically; both sides get a permanent record and a stored PDF carrying the signature certificate.

**Architecture:** One `agreements` table, no file uploads and no template layer. A pure `markdownToBlocks()` parser feeds BOTH the on-screen rendering and the pdf-lib PDF generator, so what the client reads is provably what they sign. Signing goes through a SECURITY DEFINER RPC that transitions atomically; the PDF is generated after the signature succeeds and stored in a private bucket.

**Tech Stack:** Next.js 16 (server components + actions), Supabase Postgres/RLS + Storage, pdf-lib (the one new dependency), vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-agreements-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`. Verify `cat supabase/.temp/project-ref` before any push. All commands from repo root.
- **Migration number:** the spec says `0083`. Parallel sessions work this repo — before writing it, confirm with BOTH `ls supabase/migrations` and `npx supabase migration list --linked` and take the next genuinely free number.
- Statuses exactly `draft | sent | signed | void`. Signature is typed name + intent tick — an *ordinary* electronic signature. **No UI copy may claim it is an advanced/accredited signature**, and nothing may suggest suitability for suretyships, property transfers or wills.
- `body_md` and the signature columns are **frozen once `status = 'signed'`** — enforced by a DB trigger AND the action.
- Signature first, PDF second: a PDF failure must never lose or block a valid signature.
- Members never see agreements. Drafts are never client-visible. Client reads require `has_feature('agreements')`.
- One parser only — `markdownToBlocks()` output renders the page and draws the PDF. Never render raw HTML from `body_md`.
- Pure helpers stay import-free (vitest must not pull `@/lib/supabase/server`).
- Design tokens/components per repo (`Card`, `CardHeader`, `PageHeader`, `FIELD` input style).
- Quote parenthesized shell paths. Stale `.next/* 2.*` breaks tsc → `find .next -name "* 2.*" -delete`.
- Adversarial review before push — this touches evidence and access control.

---

### Task 1: Markdown → blocks parser (TDD)

**Files:**
- Create: `lib/agreements/markdown-blocks.ts`
- Test: `lib/agreements/markdown-blocks.test.ts`

**Interfaces (produced — Tasks 3, 4, 5 all consume these):**
- `type Run = { text: string; bold: boolean }`
- `type Block = { kind: "h1" | "h2" | "h3" | "p" | "bullet" | "number"; runs: Run[] }`
- `markdownToBlocks(md: string): Block[]`
- `blockText(b: Block): string` — the block's plain text (runs joined), for tests and PDF measuring.

- [ ] **Step 1: Write the failing test**

`lib/agreements/markdown-blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockText, markdownToBlocks } from "./markdown-blocks";

describe("markdownToBlocks", () => {
  it("parses the three heading levels", () => {
    const b = markdownToBlocks("# One\n\n## Two\n\n### Three");
    expect(b.map((x) => x.kind)).toEqual(["h1", "h2", "h3"]);
    expect(blockText(b[0])).toBe("One");
    expect(blockText(b[2])).toBe("Three");
  });

  it("treats blank-line separated text as separate paragraphs", () => {
    const b = markdownToBlocks("First para.\n\nSecond para.");
    expect(b.map((x) => x.kind)).toEqual(["p", "p"]);
    expect(blockText(b[1])).toBe("Second para.");
  });

  it("joins wrapped lines within one paragraph", () => {
    const b = markdownToBlocks("one line\ncontinues here");
    expect(b).toHaveLength(1);
    expect(blockText(b[0])).toBe("one line continues here");
  });

  it("parses both bullet markers and numbered items", () => {
    const b = markdownToBlocks("- alpha\n* beta\n\n1. first\n2. second");
    expect(b.map((x) => x.kind)).toEqual(["bullet", "bullet", "number", "number"]);
    expect(blockText(b[0])).toBe("alpha");
    expect(blockText(b[3])).toBe("second");
  });

  it("splits bold runs inside a paragraph", () => {
    const b = markdownToBlocks("plain **bold** tail");
    expect(b[0].runs).toEqual([
      { text: "plain ", bold: false },
      { text: "bold", bold: true },
      { text: " tail", bold: false },
    ]);
  });

  it("handles bold inside a list item", () => {
    const b = markdownToBlocks("- pay **30 days** net");
    expect(b[0].kind).toBe("bullet");
    expect(b[0].runs.some((r) => r.bold && r.text === "30 days")).toBe(true);
  });

  it("degrades unsupported syntax to plain text rather than throwing", () => {
    const b = markdownToBlocks("> a quote\n\n| a | table |\n\n```code```");
    expect(b.every((x) => x.kind === "p")).toBe(true);
    expect(blockText(b[0])).toContain("a quote");
  });

  it("never emits raw html as markup", () => {
    const b = markdownToBlocks("<script>alert(1)</script>");
    expect(blockText(b[0])).toBe("<script>alert(1)</script>");
  });

  it("returns an empty array for empty input", () => {
    expect(markdownToBlocks("")).toEqual([]);
    expect(markdownToBlocks("   \n\n  ")).toEqual([]);
  });

  it("ignores an unmatched bold marker", () => {
    const b = markdownToBlocks("a ** dangling");
    expect(b).toHaveLength(1);
    expect(blockText(b[0])).toBe("a ** dangling");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/agreements/markdown-blocks.test.ts`
Expected: FAIL — cannot find module `./markdown-blocks`.

- [ ] **Step 3: Implement**

`lib/agreements/markdown-blocks.ts`:

```ts
/** Pure markdown → block parser for agreements. No imports (vitest-safe).
 *
 *  This is the ONLY parser: its output renders the on-screen agreement AND
 *  draws the PDF, so what a client reads is provably what they signed.
 *  Deliberately a small subset — agreements are prose, not brochures — and
 *  anything unsupported degrades to plain text rather than throwing, because
 *  an odd character must never block a signature.
 */

export type Run = { text: string; bold: boolean };
export type Block = { kind: "h1" | "h2" | "h3" | "p" | "bullet" | "number"; runs: Run[] };

export function blockText(b: Block): string {
  return b.runs.map((r) => r.text).join("");
}

/** Split on **bold**; an unmatched marker stays literal. */
function toRuns(text: string): Run[] {
  const runs: Run[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf("**");
    if (open === -1) break;
    const close = rest.indexOf("**", open + 2);
    if (close === -1) break; // dangling marker — leave it literal
    if (open > 0) runs.push({ text: rest.slice(0, open), bold: false });
    const inner = rest.slice(open + 2, close);
    if (inner) runs.push({ text: inner, bold: true });
    rest = rest.slice(close + 2);
  }
  if (rest) runs.push({ text: rest, bold: false });
  return runs.length ? runs : [{ text, bold: false }];
}

export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (!para.length) return;
    blocks.push({ kind: "p", runs: toRuns(para.join(" ")) });
    para = [];
  };

  for (const raw of (md ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: (`h${h[1].length}` as Block["kind"]), runs: toRuns(h[2].trim()) });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: "bullet", runs: toRuns(bullet[1].trim()) });
      continue;
    }
    const num = /^\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      flush();
      blocks.push({ kind: "number", runs: toRuns(num[1].trim()) });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run lib/agreements/markdown-blocks.test.ts` → all pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/agreements/markdown-blocks.ts lib/agreements/markdown-blocks.test.ts
git commit -m "feat(agreements): pure markdown block parser"
```

---

### Task 2: Migration — table, reference counter, freeze trigger, RLS, signing RPC, bucket

**Files:**
- Create: `supabase/migrations/0083_agreements.sql` (confirm the number is free first)
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- Client agreements: staff author markdown, a client manager signs it
-- electronically, and the signed PDF is stored. The portal record is
-- authoritative; the PDF is a copy.

create table public.agreement_counters (
  year    int primary key,
  last_n  int not null
);

create or replace function public.next_agreement_reference()
returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into agreement_counters (year, last_n) values (y, 1)
  on conflict (year) do update set last_n = agreement_counters.last_n + 1
  returning last_n into n;
  return 'AGR-' || y || '-' || lpad(n::text, 3, '0');
end $$;
revoke execute on function public.next_agreement_reference() from public, anon, authenticated;

create table public.agreements (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  reference             text not null unique default public.next_agreement_reference(),
  title                 text not null,
  body_md               text not null,
  status                text not null default 'draft'
                          check (status in ('draft','sent','signed','void')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  sent_at               timestamptz,
  signed_at             timestamptz,
  signed_by_profile_id  uuid references public.profiles(id) on delete set null,
  signer_name           text,
  signer_email          text,
  signer_ip             text,
  signer_user_agent     text,
  pdf_path              text,
  void_reason           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index agreements_client_idx on public.agreements (client_id, created_at desc);
create index agreements_status_idx on public.agreements (status);

-- A signed agreement is evidence: its text and signature must never change.
-- The app guards this too; this trigger is what makes it true.
create or replace function public.freeze_signed_agreement()
returns trigger language plpgsql as $$
begin
  if old.status = 'signed' then
    if new.body_md is distinct from old.body_md
       or new.title is distinct from old.title
       or new.signed_at is distinct from old.signed_at
       or new.signed_by_profile_id is distinct from old.signed_by_profile_id
       or new.signer_name is distinct from old.signer_name
       or new.signer_email is distinct from old.signer_email
       or new.signer_ip is distinct from old.signer_ip
       or new.signer_user_agent is distinct from old.signer_user_agent
       or new.status is distinct from old.status then
      raise exception 'a signed agreement cannot be altered';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger agreements_freeze before update on public.agreements
  for each row execute function public.freeze_signed_agreement();

alter table public.agreements enable row level security;

create policy agreements_staff on public.agreements
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Managers of that client, sent agreements only, and only if the feature is
-- enabled for them. Members never see agreements. No client write path.
create policy agreements_manager_read on public.agreements
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
    and status <> 'draft'
    and public.has_feature('agreements')
  );

-- Signing: atomic transition, returns the row only if THIS call did it.
create or replace function public.sign_agreement(
  p_agreement_id uuid,
  p_signer_name  text,
  p_ip           text,
  p_user_agent   text
) returns public.agreements
language plpgsql security definer set search_path = public as $$
declare
  v_row public.agreements;
  v_email text;
begin
  if coalesce(trim(p_signer_name), '') = '' then
    raise exception 'a signature needs your full name';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  update public.agreements a
     set status               = 'signed',
         signed_at            = now(),
         signed_by_profile_id = auth.uid(),
         signer_name          = trim(p_signer_name),
         signer_email         = v_email,
         signer_ip            = p_ip,
         signer_user_agent    = left(coalesce(p_user_agent, ''), 400)
   where a.id = p_agreement_id
     and a.status = 'sent'
     and a.client_id = public.current_client_id()
     and public.current_user_role() = 'client_manager'
     and public.has_feature('agreements')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'this agreement is not available for you to sign';
  end if;
  return v_row;
end $$;
grant execute on function public.sign_agreement(uuid, text, text, text) to authenticated;

-- Private bucket for the generated PDFs (server-side access only).
insert into storage.buckets (id, name, public)
values ('agreement-pdfs', 'agreement-pdfs', false)
on conflict (id) do nothing;
```

> Note: the freeze trigger blocks `status` changes on a signed row, so
> `pdf_path` is the only field the post-signature patch may write — which is
> exactly what Task 3's action does.

- [ ] **Step 2:** Verify ref, then `npx supabase db push --linked` → applied.
- [ ] **Step 3:** `npx supabase gen types typescript --linked > lib/types/database.ts`; `find .next -name "* 2.*" -delete`; `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0083_agreements.sql lib/types/database.ts
git commit -m "feat(agreements): table, reference counter, freeze trigger, RLS, signing RPC"
```

---

### Task 3: PDF generator

**Files:**
- Create: `lib/agreements/pdf.ts`
- Modify: `package.json` (add `pdf-lib`)

**Interfaces:**
- Consumes: `Block`, `markdownToBlocks`, `blockText` (Task 1).
- Produces: `buildAgreementPdf(input: { reference: string; title: string; bodyMd: string; clientName: string; signerName: string; signerEmail: string; signedAt: string; signerIp: string | null }): Promise<Uint8Array>`

- [ ] **Step 1: Add the dependency**

Run: `npm install pdf-lib`

- [ ] **Step 2: Write the generator**

`lib/agreements/pdf.ts`:

```ts
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { markdownToBlocks, type Block } from "./markdown-blocks";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const BODY = 11;
const LEADING = 1.45;

type Fonts = { regular: PDFFont; bold: PDFFont };

const sizeFor = (k: Block["kind"]) => (k === "h1" ? 19 : k === "h2" ? 15 : k === "h3" ? 12.5 : BODY);
const gapBefore = (k: Block["kind"]) => (k === "h1" ? 20 : k === "h2" ? 16 : k === "h3" ? 12 : 8);

/** Greedy wrap of a block's runs into lines that fit `width`. */
function wrap(block: Block, fonts: Fonts, size: number, width: number) {
  const lines: { text: string; bold: boolean }[][] = [[]];
  let used = 0;
  for (const run of block.runs) {
    const font = run.bold ? fonts.bold : fonts.regular;
    for (const word of run.text.split(/(\s+)/)) {
      if (!word) continue;
      const w = font.widthOfTextAtSize(word, size);
      if (used + w > width && used > 0) {
        lines.push([]);
        used = 0;
        if (/^\s+$/.test(word)) continue; // don't start a line with the wrap space
      }
      lines[lines.length - 1].push({ text: word, bold: run.bold });
      used += w;
    }
  }
  return lines;
}

/** The agreement as a PDF: body from the same parser the screen uses, plus a
 *  signature certificate. Generated once at signing and stored — never
 *  re-rendered later, so the file always matches what was downloaded. */
export async function buildAgreementPdf(input: {
  reference: string;
  title: string;
  bodyMd: string;
  clientName: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  signerIp: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.reference} — ${input.title}`);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage(A4);
  pages.push(page);
  let y = A4[1] - MARGIN;
  const maxWidth = A4[0] - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN;
  };

  const drawLine = (parts: { text: string; bold: boolean }[], size: number) => {
    if (y < MARGIN + 60) newPage();
    let x = MARGIN;
    for (const p of parts) {
      const font = p.bold ? fonts.bold : fonts.regular;
      page.drawText(p.text, { x, y, size, font, color: rgb(0.09, 0.09, 0.11) });
      x += font.widthOfTextAtSize(p.text, size);
    }
    y -= size * LEADING;
  };

  // Title block
  drawLine([{ text: input.title, bold: true }], 22);
  y -= 4;
  drawLine([{ text: `${input.reference} · ${input.clientName}`, bold: false }], 10);
  y -= 14;

  for (const block of markdownToBlocks(input.bodyMd)) {
    const size = sizeFor(block.kind);
    y -= gapBefore(block.kind);
    const indent = block.kind === "bullet" || block.kind === "number" ? 16 : 0;
    const lines = wrap(block, fonts, size, maxWidth - indent);
    lines.forEach((parts, i) => {
      if (!parts.length) return;
      const bulletPrefix =
        i === 0 && block.kind === "bullet" ? [{ text: "•  ", bold: false }] : [];
      const headed = block.kind.startsWith("h");
      drawLine(
        [...bulletPrefix, ...parts.map((p) => ({ ...p, bold: p.bold || headed }))],
        size,
      );
    });
  }

  // Signature certificate — always starts on a fresh page so it can't be
  // half-orphaned at the bottom of the last body page.
  newPage();
  drawLine([{ text: "Signature", bold: true }], 15);
  y -= 10;
  const when = new Date(input.signedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  const certLines = [
    `Signed electronically on ${when} (SAST)`,
    `by ${input.signerName} (${input.signerEmail})`,
    `for ${input.clientName}`,
    `Issued by Rocking (Pty) Ltd`,
    `Reference ${input.reference}`,
    ...(input.signerIp ? [`IP address ${input.signerIp}`] : []),
  ];
  for (const line of certLines) drawLine([{ text: line, bold: false }], BODY);
  y -= 12;
  for (const line of wrap(
    { kind: "p", runs: [{ text: "This agreement was signed in the Rocking client portal, where the authoritative record is held.", bold: false }] },
    fonts,
    9.5,
    maxWidth,
  )) drawLine(line, 9.5);

  // Footer on every page, once the total is known.
  pages.forEach((p, i) => {
    p.drawText(`${input.reference} · page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 24,
      size: 8.5,
      font: fonts.regular,
      color: rgb(0.55, 0.55, 0.58),
    });
  });

  return doc.save();
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Smoke-test the generator standalone**

Write `/tmp/_pdfsmoke.mjs` that imports the built helper via `npx tsx`, feeds it a two-heading/one-list sample plus fake signature fields, writes `/tmp/agreement-smoke.pdf`, and prints the byte length and page count. Confirm the file opens and the certificate page reads correctly. Delete the temp files after.

- [ ] **Step 5: Commit**

```bash
git add lib/agreements/pdf.ts package.json package-lock.json
git commit -m "feat(agreements): pdf-lib generator with signature certificate"
```

---

### Task 4: View layer, actions, and the shared renderer

**Files:**
- Create: `lib/views/agreements.ts`
- Create: `lib/actions/agreements.ts`
- Create: `components/AgreementBody.tsx`
- Modify: `lib/feature-access.ts` (add `agreements`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `type AgreementRow = { id, reference, title, status, clientId, clientName, createdAt, sentAt, signedAt, signerName, signerEmail, hasPdf }`
  - `getAgreements(filters?: { clientId?: string; status?: string }): Promise<AgreementRow[]>`
  - `getAgreement(id: string): Promise<(AgreementRow & { bodyMd: string; signerIp: string | null; voidReason: string | null }) | null>`
  - `agreementPdfUrl(id: string): Promise<string | null>` — 5-minute signed URL
  - Actions: `createAgreement(formData)`, `updateDraft(id, formData)`, `sendAgreement(id)`, `voidAgreement(id, formData)`, `signAgreement(id, formData)`
  - `<AgreementBody md={string} />`

- [ ] **Step 1: Add the feature key**

In `lib/feature-access.ts` add `"agreements"` to `FEATURES`, `FEATURE_LABELS` (`Agreements`) and `FEATURE_HREFS` (`/agreements`). Run `npm test` — the existing feature-access tests iterate `FEATURES`, so they must still pass.

- [ ] **Step 2: Shared renderer**

`components/AgreementBody.tsx` — server component, renders `markdownToBlocks(md)` as JSX. Headings map to `h2/h3/h4` with the repo's type scale, `p` to `text-[15px] leading-relaxed text-ink-2`, `bullet`/`number` to `li` inside `ul`/`ol` (consecutive same-kind blocks grouped into one list), bold runs to `<strong>`. Never `dangerouslySetInnerHTML`.

- [ ] **Step 3: View layer**

`lib/views/agreements.ts` — RLS-scoped reads via `createClient()`, mapping snake_case → the types above, client names joined from `clients`. `agreementPdfUrl` reads the row through the RLS client first (so a client can only ever sign URLs for their own agreements) and then signs `pdf_path` with the service client for 300 seconds, returning `null` when there's no PDF or no access.

- [ ] **Step 4: Actions**

`lib/actions/agreements.ts` — `"use server"`.
- `createAgreement`, `updateDraft`, `sendAgreement`, `voidAgreement`: staff-guarded (`getCurrentProfile()` role check), RLS client. `updateDraft` additionally refuses if the row's status isn't `draft`. `sendAgreement` sets `status='sent'`, `sent_at=now()`, then emails the client's active managers via `sendOnboardingEmail`'s sibling path in `lib/notify.ts` — a plain `sendEmail` with `category: "agreement"` and the client id, so it lands in the activity feed.
- `signAgreement(id, formData)`: reads `signer_name` from the form, pulls the caller's IP from the `x-forwarded-for` header and the user agent from `user-agent` (via `headers()`), calls `supabase.rpc("sign_agreement", …)` on the **RLS client** (the RPC does the authorisation). On success it builds the PDF with `buildAgreementPdf`, uploads to `agreement-pdfs/{client_id}/{id}.pdf` via the service client, and patches `pdf_path`. **The PDF step is wrapped in try/catch and logged on failure — a PDF error must never surface as a failed signature**, because the signature is already legally recorded. Then notifies Shawn by email and revalidates both agreement paths.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/views/agreements.ts lib/actions/agreements.ts components/AgreementBody.tsx lib/feature-access.ts
git commit -m "feat(agreements): view layer, actions, shared markdown renderer"
```

---

### Task 5: Staff surfaces

**Files:**
- Create: `app/(admin)/admin/agreements/page.tsx`
- Create: `app/(admin)/admin/agreements/new/page.tsx`
- Create: `app/(admin)/admin/agreements/AgreementEditor.tsx`
- Create: `app/(admin)/admin/agreements/[id]/page.tsx`
- Modify: `lib/nav.ts` (Business group → `{ label: "Agreements", href: "/admin/agreements" }`)

- [ ] **Step 1: List page** — staff guard; table of reference, client, title, status pill (`draft` neutral, `sent` warn-tinted, `signed` good, `void` muted), sent/signed dates; filter chips by status and a client dropdown following the `/admin/security` searchParams pattern; "New agreement" primary link.

- [ ] **Step 2: Editor** — `AgreementEditor.tsx`, a client component with a title field, a client `<select>` (only on new), a monospace `<textarea>` for markdown, and a live preview beside it rendering `markdownToBlocks` output (import the parser directly — it's pure). Submits to `createAgreement` or `updateDraft`.

- [ ] **Step 3: New page** — staff guard, loads clients, renders `AgreementEditor`.

- [ ] **Step 4: Detail page** — staff guard. Draft: editor + **Send**. Sent: "Awaiting signature since {date}", the rendered body, and **Void** (reason required). Signed: green banner naming signer/date, the rendered body, the signature record, and **Download PDF** (server action redirecting to `agreementPdfUrl`). Void: reason shown, body read-only.

- [ ] **Step 5: Nav + build**

Add the nav entry, then `npm run build` → clean, `/admin/agreements` present.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/agreements" lib/nav.ts
git commit -m "feat(agreements): staff authoring, sending and management"
```

---

### Task 6: Client signing surface

**Files:**
- Create: `app/(app)/agreements/page.tsx`
- Create: `app/(app)/agreements/[id]/page.tsx`
- Create: `app/(app)/agreements/[id]/SignBlock.tsx`
- Modify: `lib/nav.ts` (client_manager Account group → `{ label: "Agreements", href: "/agreements" }`)

- [ ] **Step 1: List page** — `getCurrentProfile()`; redirect non-managers home; `canAccess(role, overrides, "agreements")` guard (mirroring `/billing`). Lists the client's sent/signed agreements with status and, when signed, a download link.

- [ ] **Step 2: Detail page** — same guards. Renders `<AgreementBody>`, then either `<SignBlock>` (status `sent`) or the signed confirmation with **Download PDF**.

- [ ] **Step 3: SignBlock** — client component: full-name text input, a required checkbox labelled **"I agree to these terms and intend this as my electronic signature."**, and a Sign button disabled until both are filled. Submits `signAgreement.bind(null, id)` through `useActionState`, showing the returned error inline. Copy must not claim an advanced/accredited signature. Below it, muted: "Your name, email, the time, and your IP address are recorded with this signature."

- [ ] **Step 4: Nav + build**

`npm run build` → clean; `/agreements` and `/agreements/[id]` present.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/agreements" lib/nav.ts
git commit -m "feat(agreements): client reading and signing"
```

---

### Task 7: Verify end-to-end + adversarial review + push

- [ ] **Step 1:** `npm test && npm run build` — both green.
- [ ] **Step 2: Live end-to-end against a throwaway client.** The dev server points at PRODUCTION, so never test against a real client. Create a temp client + a temp manager profile via the service role. Then: create a draft, send it, sign it as that manager through the UI, download the PDF and confirm its text matches the on-screen agreement and the certificate names the right signer/date/reference.
- [ ] **Step 3: Prove the guarantees**, via service-role and a real manager JWT:
  - Second signing attempt on the same agreement fails.
  - A direct `update` to a signed row's `body_md` raises `a signed agreement cannot be altered`.
  - A manager of a *different* client gets 0 rows and cannot sign it.
  - A `client_member` of the same client gets 0 rows.
  - A draft returns 0 rows for the client manager.
  - With `feature_overrides = {"agreements": false}`, the manager gets 0 rows.
- [ ] **Step 4:** Delete every temp record (agreement, PDF object, profile, auth user, client) and confirm none remain.
- [ ] **Step 5: Adversarial review** over the full diff — focus: can anyone read or sign an agreement they shouldn't; can a signed agreement be altered by any path (including `pdf_path` patch and the void action); does a PDF failure lose a signature; is the RPC's atomicity real under concurrent signing; does any UI copy overstate the signature's legal status.
- [ ] **Step 6:** Fix findings, push, and health-check `/admin/agreements` and `/agreements` after deploy.
