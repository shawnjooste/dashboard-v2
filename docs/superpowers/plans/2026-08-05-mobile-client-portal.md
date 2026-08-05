# Mobile Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in client on a phone gets a clean two-tab app experience — Tickets and Status — instead of a wall of navigation.

**Architecture:** Mobile-only changes behind Tailwind's `md` breakpoint. The shell hides the sidebar below `md` and renders a slim top bar plus a fixed two-tab bottom bar; the four client-facing screens (support list, new ticket, ticket thread, status) get stacking/touch-target passes. Desktop markup paths are untouched.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, existing `@/components/ui` primitives.

**Spec:** `docs/superpowers/specs/2026-08-05-mobile-client-portal-design.md`

## Global Constraints

- **Desktop must not change.** Every change is behind a mobile-only breakpoint (`md:` restores or the element is `md:hidden`). A desktop screenshot at 1280px must be identical before and after.
- Mobile nav shows **exactly two destinations**: Tickets (`/support`) and Status (`/status`). The other seven sections are hard-hidden from mobile nav; their pages still render by direct URL.
- The two tabs live in `lib/nav.ts` as `MOBILE_NAV` — not hardcoded in the shell.
- **All form inputs ≥16px font on mobile** (below 16px iOS Safari zooms the viewport on focus).
- Touch targets ≥44px. No hover-only affordances on mobile (`group-hover` reveals don't exist on touch).
- Bottom bar must not cover content: main gets bottom padding including `env(safe-area-inset-bottom)`.
- Presentation only — no data, query, permission or RLS changes. Admin surface (`(admin)`) untouched.
- No PWA/manifest work.
- Verification is screenshots at 375×812 (not unit tests — this is layout). A dev server may already be running on port 3010 from another session; reuse it rather than starting a competing one.
- Repo hygiene: stale `.next/* 2.*` files break `tsc` — `find .next -name "* 2.*" -delete` if it complains. Don't touch files another session is editing (`scripts/m365-pull.mjs`).

---

### Task 1: MOBILE_NAV constant

**Files:**
- Modify: `lib/nav.ts`

**Interfaces:**
- Produces: `MOBILE_NAV: NavItem[]` — exactly `[{ label: "Tickets", href: "/support" }, { label: "Status", href: "/status" }]`. Task 2 imports it.

- [ ] **Step 1: Add the constant**

Append to `lib/nav.ts` (after the `NAV` export):

```ts
/** What a phone shows a signed-in client: tickets and service status, nothing
 *  else. Deliberately two items — the other sections stay desktop-only and are
 *  hidden from mobile navigation entirely (they still render by direct URL).
 *  Keep this list here rather than in the shell so "what mobile offers" is one
 *  editable place. */
export const MOBILE_NAV: NavItem[] = [
  { label: "Tickets", href: "/support" },
  { label: "Status", href: "/status" },
];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/nav.ts
git commit -m "feat(mobile): MOBILE_NAV — the two destinations a phone offers"
```

---

### Task 2: Bottom tab bar component

**Files:**
- Create: `components/MobileTabBar.tsx`

**Interfaces:**
- Consumes: `MOBILE_NAV` (Task 1).
- Produces: `<MobileTabBar />` — a client component, fixed to the bottom, hidden at `md`+. Task 3 mounts it.

- [ ] **Step 1: Write the component**

`components/MobileTabBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV } from "@/lib/nav";

/** Fixed two-tab bar — the entire navigation on a phone. Hidden at md+ where
 *  the sidebar takes over. Same active rule as the sidebar: prefix match, so a
 *  ticket thread keeps Tickets lit. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {MOBILE_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold transition-colors ${
              active ? "text-brand" : "text-ink-3"
            }`}
          >
            <span
              aria-hidden
              className={`h-[3px] w-8 rounded-full ${active ? "bg-brand" : "bg-transparent"}`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add components/MobileTabBar.tsx
git commit -m "feat(mobile): two-tab bottom bar"
```

---

### Task 3: Shell — hide sidebar on mobile, add top bar + tab bar

**Files:**
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `<MobileTabBar />` (Task 2).

- [ ] **Step 1: Hide the sidebar below md**

In `components/AppShell.tsx`, the `<aside>` currently renders as a scrolling strip on mobile. Change its opening tag from:

```tsx
        <aside className="flex flex-col gap-2 border-b border-line bg-card px-3 pb-4 md:w-[248px] md:shrink-0 md:gap-0 md:border-b-0 md:border-r print:hidden">
```

to:

```tsx
        <aside className="hidden flex-col gap-2 border-b border-line bg-card px-3 pb-4 md:flex md:w-[248px] md:shrink-0 md:gap-0 md:border-b-0 md:border-r print:hidden">
```

Then delete the now-dead mobile sign-out form inside the aside (it was the `md:hidden` fallback and is replaced by the mobile top bar):

```tsx
          {/* mobile sign-out */}
          <form action="/auth/signout" method="post" className="md:hidden">
            <button className="rounded-md border border-line px-3 py-1 text-sm text-ink-2 hover:bg-line-soft">
              Sign out
            </button>
          </form>
```

- [ ] **Step 2: Add the mobile top bar**

The existing top strip (`<div className="flex h-12 items-center gap-5 border-b border-line bg-card px-6 print:hidden">`) is the desktop one. Replace that opening line and its contents so the row carries branding on mobile and stays identical on desktop — change it to:

```tsx
          <div className="flex h-12 items-center gap-5 border-b border-line bg-card px-4 md:px-6 print:hidden">
            {/* Mobile: logo doubles as "home" — on a phone, tickets IS home. */}
            <Link href="/support" className="md:hidden">
              <Image src={logo} alt="Rocking" priority className="h-5 w-auto" />
            </Link>
            <div className="ml-auto flex items-center gap-5">
              {pendingMode !== "rejected" && (
                <Link
                  href={statusHref}
                  className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink-3 hover:text-ink"
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: dotColour(statusType) }}
                  />
                  Status
                </Link>
              )}
              <form action="/auth/signout" method="post" className="md:hidden">
                <button className="rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-ink-2">
                  Sign out
                </button>
              </form>
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-white">
                {initials(email)}
              </span>
            </div>
          </div>
```

- [ ] **Step 3: Mount the tab bar and pad the main column**

Add the import at the top of the file:

```tsx
import { MobileTabBar } from "./MobileTabBar";
```

Change the `<main>` opening tag from:

```tsx
          <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 py-9 md:px-10 print:max-w-none print:p-0">
```

to (extra bottom padding on mobile so the fixed bar never covers the last row):

```tsx
          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 md:px-10 md:py-9 md:pb-9 print:max-w-none print:p-0">
```

and render the bar just before the final closing `</div>` of the component (sibling of the `flex min-h-0 flex-1` row):

```tsx
      <MobileTabBar />
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add components/AppShell.tsx
git commit -m "feat(mobile): app shell — sidebar hidden, top bar + bottom tabs"
```

---

### Task 4: Support list — collapse escalation, tappable ticket cards

**Files:**
- Modify: `components/SupportEscalation.tsx`
- Modify: `app/(app)/support/page.tsx`

- [ ] **Step 1: Collapse the escalation block on mobile**

`SupportEscalation` always renders expanded, pushing tickets below the fold on a phone. It must be **collapsed on mobile and open on desktop** — which a single element cannot express, because `open` is an HTML attribute and CSS cannot set it responsively. So render the steps once into a variable and mount it in two wrappers, exactly one of which is visible at any width.

Restructure `components/SupportEscalation.tsx` so the existing `<ol>…</ol>` (keep its contents verbatim — the wording was agreed with Shawn 2026-07-21 and must not change) is assigned to a `steps` variable, and the component returns:

```tsx
export function SupportEscalation() {
  const steps = (
    <ol className="mt-2 space-y-1.5 text-sm text-warn-ink">
      {/* …existing <li> items, copied verbatim… */}
    </ol>
  );

  return (
    <>
      {/* Phone: collapsed by default so the tickets sit above the fold. */}
      <details className="rounded-lg bg-warn-tint px-4 py-3.5 md:hidden">
        <summary className="cursor-pointer text-[13px] font-semibold uppercase tracking-[0.5px] text-warn-ink">
          Support &amp; escalation
        </summary>
        {steps}
      </details>

      {/* Desktop: unchanged — always visible. */}
      <div className="hidden rounded-lg bg-warn-tint px-4 py-3.5 md:block">
        <p className="text-[13px] font-semibold uppercase tracking-[0.5px] text-warn-ink">
          Support &amp; escalation
        </p>
        {steps}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Make ticket rows tappable cards on mobile**

In `app/(app)/support/page.tsx`, the ticket `<Link>` is a single-line flex row with a hover-revealed "Book support" pill. Replace the whole `<Link>…</Link>` block inside `tickets.map(...)` with:

```tsx
            <Link
              key={t.id}
              href={`/support/${t.id}`}
              className="group flex flex-col gap-1.5 border-b border-line-soft px-4 py-3.5 last:border-0 hover:bg-canvas md:flex-row md:items-center md:gap-3 md:py-3"
            >
              <div className="flex items-center gap-2.5">
                <StatusPill tone={STATUS_TONE[t.status] ?? "warn"} label={STATUS_LABEL[t.status] ?? t.status} />
                <span className="text-xs text-faint md:hidden">{t.updatedAt.slice(0, 10)}</span>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-ink md:truncate">{t.subject}</div>
                <div className="truncate text-xs text-muted">
                  #{t.number}
                  {scope.isManager && t.customerEmail !== scope.email ? ` · ${t.customerEmail}` : ""}
                  {t.preview ? ` · ${t.preview}` : ""}
                </div>
              </div>
              <span className="ml-auto hidden shrink-0 text-xs text-faint md:inline">{t.updatedAt.slice(0, 10)}</span>
              {t.status !== "closed" && (
                <span className="shrink-0 self-start rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors md:self-auto md:group-hover:border-brand md:group-hover:bg-brand-tint md:group-hover:text-brand">
                  Book support
                </span>
              )}
            </Link>
```

Key mobile differences: column layout, date moves up beside the status pill, subject wraps instead of truncating, and "Book support" is always visible (the `group-hover` reveal is now `md:`-only since hover doesn't exist on touch).

- [ ] **Step 3: Build**

Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add components/SupportEscalation.tsx "app/(app)/support/page.tsx"
git commit -m "feat(mobile): support list — collapsible escalation, tappable ticket cards"
```

---

### Task 5: New-ticket form and ticket thread

The actual form lives in `GetHelpForm.tsx` (the `new/page.tsx` route is just a
data loader), and the reply box lives in `ReplyForm.tsx`.

**Files:**
- Modify: `app/(app)/support/new/GetHelpForm.tsx`
- Modify: `app/(app)/support/[id]/ReplyForm.tsx`
- Modify: `app/(app)/support/[id]/page.tsx`

- [ ] **Step 1: 16px inputs + full-width submit on the get-help form**

In `app/(app)/support/new/GetHelpForm.tsx`, both fields are currently
`text-[13.5px]`, which makes iOS Safari zoom the viewport on focus. Change the
subject input and message textarea className from:

```tsx
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13.5px] text-ink outline-none"
```

to (applies to both, `replace_all`):

```tsx
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-base text-ink outline-none md:text-[13.5px]"
```

and the submit button className from:

```tsx
      className="inline-flex items-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
```

to:

```tsx
      className="inline-flex w-full min-h-[44px] items-center justify-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50 md:w-auto"
```

- [ ] **Step 2: Same treatment for the reply box**

In `app/(app)/support/[id]/ReplyForm.tsx`, change the textarea className from:

```tsx
        className="w-full rounded border border-gray-300 px-3 py-2"
```

to:

```tsx
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-base text-ink outline-none md:text-[13.5px]"
```

and the send button from:

```tsx
      className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
```

to:

```tsx
      className="w-full min-h-[44px] rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50 md:w-auto"
```

(This also drops the stray raw `gray-*` / `rounded` values for the repo's design tokens — they are the only ones left on this screen.)

- [ ] **Step 3: Let long thread content wrap**

In `app/(app)/support/[id]/page.tsx`, the message author row and body can push
the page wider than 375px when a subject or URL has no spaces. Change the
author row from:

```tsx
                <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-[11px]">
```

to:

```tsx
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line-soft px-4 py-[11px]">
```

and the message body from:

```tsx
                <p className="whitespace-pre-line px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
```

to:

```tsx
                <p className="whitespace-pre-line break-words px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
```

- [ ] **Step 4: Build**

Run: `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/support/new/GetHelpForm.tsx" "app/(app)/support/[id]/ReplyForm.tsx" "app/(app)/support/[id]/page.tsx"
git commit -m "feat(mobile): ticket form and thread stack cleanly on a phone"
```

---

### Task 6: Status page pass

**Files:**
- Modify: `components/status/StatusView.tsx`

The status page is already list-shaped and uses the design tokens, so this is
the lightest task: let its rows wrap rather than overflow 375px.

- [ ] **Step 1: Let the incident/service rows wrap**

In `components/status/StatusView.tsx`, change the row at line ~85 from:

```tsx
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3.5">
```

to:

```tsx
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line-soft px-4 py-3.5">
```

- [ ] **Step 2: Check the rest of the file for mobile hazards and fix only what fails**

Read the file (`sed -n '1,200p' components/status/StatusView.tsx`) and apply
these only where the markup actually violates them — do not invent changes:
- any other `flex items-center gap-*` row carrying three or more children gets `flex-wrap`;
- any incident/update body paragraph gets `break-words`;
- any fixed `w-[NNNpx]` gets a `max-w-full` companion;
- any button or button-styled link gets `min-h-[44px]`.

If a rule finds no violation, that rule makes no edit. Record which rules
applied in the commit body.

- [ ] **Step 3: Build**

Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add components/status/StatusView.tsx
git commit -m "feat(mobile): status page stacks and wraps on a phone"
```

---

### Task 7: Verify at 375px + desktop regression, then push

- [ ] **Step 1:** `npm test && npm run build` — both green.

- [ ] **Step 2: Sign in on the dev server as the test client.** A dev server may already be running on port 3010 (another session) — reuse it. Generate a local magic link for the JoosteCo test user:

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && node -e '
const {readFileSync}=require("fs");
const env={};for(const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"");}
fetch(env.NEXT_PUBLIC_SUPABASE_URL+"/auth/v1/admin/generate_link",{method:"POST",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({type:"magiclink",email:"shawn@jooste.co"})}).then(r=>r.json()).then(j=>console.log("http://localhost:3010/auth/confirm?token_hash="+(j.hashed_token||j.properties.hashed_token)+"&type=magiclink&next=/support"));
'
```

- [ ] **Step 3: Mobile screenshots at 375×812** of `/support`, `/support/new`, a ticket thread, and `/status`. For each, confirm: the first screen shows real content (not nav), the bottom bar shows two tabs with the right one lit, no content hidden behind the bar, and `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal page scroll).

- [ ] **Step 4: Desktop regression** — resize to 1280px, screenshot `/support`, and confirm the sidebar and layout are unchanged from before this work.

- [ ] **Step 5:** Push to `main`; after deploy, health-check `/support` (307 → login when unauthenticated).
