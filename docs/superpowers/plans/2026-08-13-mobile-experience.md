# Mobile Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every link we email a client open and work properly on a phone, and replace the two-item mobile navigation with a structure that reaches everything.

**Architecture:** Three layers, in dependency order. First, deep links survive sign-in — a new `safeNext()` guard plus `?next=` plumbing through middleware, the app layout, and the OTP form. Second, navigation derives from one shared, tested function so mobile and desktop cannot diverge. Third, the pages themselves: a "needs you" Home, and a quote document that reflows below 768px while printing identically to today.

**Tech Stack:** Next.js 16 App Router (server components, server actions), TypeScript, Tailwind v4, Supabase (RLS), Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-13-mobile-experience-design.md`. Read it before Task 1.
- **Mobile means `< 768px`** — Tailwind's `md:` boundary. Verify at 375px.
- **Text inputs must be ≥ 16px on mobile** (`text-base md:text-[13.5px]`). Below 16px iOS zooms the viewport on focus.
- **Tap targets ≥ 44px.**
- **Desktop must not change** except for the `NeedsYou` block on Home. Any other desktop movement is a regression.
- **Printed quote output must stay byte-identical.** `components/QuoteDocument.module.css` is what clients receive as a PDF.
- **Design tokens only** — `bg-card border-line text-ink/ink-2/ink-3 text-muted text-faint text-brand bg-warn-tint text-warn-ink bg-brand-tint text-good`. No raw `gray-*` values.
- **Branch:** work on `preview`. Never commit directly to `main`.
- **The local dev server points at the production database.** Never test destructive actions against real client rows.
- Run `npm test`, `npx tsc --noEmit`, and `npm run build` before every commit.

---

### Task 1: `safeNext()` — the open-redirect guard

The single most security-sensitive function in this plan. It turns an untrusted `?next=` parameter into a redirect target, and it appears in URLs we email. It fails closed.

**Files:**
- Modify: `lib/auth/routing.ts`
- Modify: `lib/auth/__tests__/routing.test.ts`
- Modify: `app/auth/confirm/route.ts:15-17`

**Interfaces:**
- Consumes: `POST_LOGIN_PATH` (already exported from `lib/auth/routing.ts`).
- Produces: `safeNext(param: string | null | undefined): string` — always returns a safe, relative path; falls back to `POST_LOGIN_PATH`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/auth/__tests__/routing.test.ts`. Import `safeNext` alongside the existing imports on line 2.

```ts
describe("safeNext", () => {
  it("keeps a relative path, including its query string", () => {
    expect(safeNext("/quotes/abc")).toBe("/quotes/abc");
    expect(safeNext("/quotes/abc?reference=qs-123")).toBe("/quotes/abc?reference=qs-123");
  });

  it("falls back when nothing was asked for", () => {
    expect(safeNext(null)).toBe(POST_LOGIN_PATH);
    expect(safeNext(undefined)).toBe(POST_LOGIN_PATH);
    expect(safeNext("")).toBe(POST_LOGIN_PATH);
  });

  // Everything below is an attack. next= travels in emailed URLs, so each of
  // these is something a third party could put in front of a client.
  it("refuses a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("//evil.com/quotes/abc")).toBe(POST_LOGIN_PATH);
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("http://evil.com")).toBe(POST_LOGIN_PATH);
  });

  it("refuses a backslash path — browsers treat \\ as /", () => {
    expect(safeNext("/\\evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("/\\/evil.com")).toBe(POST_LOGIN_PATH);
  });

  it("refuses a scheme that isn't a path at all", () => {
    expect(safeNext("javascript:alert(1)")).toBe(POST_LOGIN_PATH);
    expect(safeNext("data:text/html,<script>")).toBe(POST_LOGIN_PATH);
  });

  it("refuses anything that doesn't start with a single slash", () => {
    expect(safeNext("quotes/abc")).toBe(POST_LOGIN_PATH);
    expect(safeNext(" /quotes/abc")).toBe(POST_LOGIN_PATH);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/auth/__tests__/routing.test.ts`
Expected: FAIL — `safeNext is not a function` / no export named `safeNext`.

- [ ] **Step 3: Implement `safeNext`**

Add to `lib/auth/routing.ts`, below `POST_LOGIN_PATH`:

```ts
/** Turns an untrusted ?next= into a redirect target. Accepts relative,
 *  single-slash paths only; anything else falls back to the default landing
 *  page.
 *
 *  This guards an open redirect on a URL that travels in emails, so it fails
 *  closed — an unrecognised shape is rejected, never sanitised and used. The
 *  protocol-relative case is the one that bites: Next's redirect() treats
 *  "//evil.com" as off-site, so it must never reach it. */
export function safeNext(param: string | null | undefined): string {
  if (!param) return POST_LOGIN_PATH;
  if (!param.startsWith("/")) return POST_LOGIN_PATH;
  // "//host" is protocol-relative; "/\host" is the same thing to browsers
  // that normalise backslashes.
  if (param.startsWith("//") || param.startsWith("/\\")) return POST_LOGIN_PATH;
  return param;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/auth/__tests__/routing.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Replace the duplicated guard in the magic-link handler**

In `app/auth/confirm/route.ts`, add `safeNext` to the existing import on line 4, then replace lines 15-17:

```ts
  const next = safeNext(searchParams.get("next"));
```

Delete the now-dead `nextParam` variable and the inline comment above it — the rule lives in `safeNext` with its own tests.

- [ ] **Step 6: Verify the whole suite and types**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/routing.ts lib/auth/__tests__/routing.test.ts app/auth/confirm/route.ts
git commit -m "feat(auth): add safeNext() open-redirect guard

One tested function replaces the inline guard in the magic-link handler, so
login and confirm can't drift apart. Fails closed: protocol-relative,
absolute, backslash and non-path values all fall back to the default landing
page."
```

---

### Task 2: Deep links survive sign-in

The foundation. A client clicking an emailed quote link while signed out currently loses the destination entirely. Fixes desktop as well as mobile.

**Files:**
- Modify: `middleware.ts`
- Modify: `lib/auth/routing.ts`
- Modify: `lib/auth/__tests__/routing.test.ts`
- Modify: `app/(app)/layout.tsx:26`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/login/LoginCard.tsx`
- Modify: `app/(auth)/login/actions.ts`

**Interfaces:**
- Consumes: `safeNext()`, `POST_LOGIN_PATH` from Task 1.
- Produces: `intendedPath(pathname: string, search: string): string` — joins path and query for the `next` parameter. Header `x-search` carries `nextUrl.search` from middleware.

- [ ] **Step 1: Write the failing test for `intendedPath`**

Add to `lib/auth/__tests__/routing.test.ts`:

```ts
describe("intendedPath", () => {
  it("returns the path when there's no query", () => {
    expect(intendedPath("/quotes/abc", "")).toBe("/quotes/abc");
  });
  it("keeps the query string — Paystack returns a reference on it", () => {
    expect(intendedPath("/quotes/abc", "?reference=qs-123")).toBe("/quotes/abc?reference=qs-123");
  });
  it("never sends the user back to the login page", () => {
    expect(intendedPath("/login", "")).toBe(POST_LOGIN_PATH);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/auth/__tests__/routing.test.ts -t intendedPath`
Expected: FAIL — `intendedPath is not a function`.

- [ ] **Step 3: Implement `intendedPath`**

Add to `lib/auth/routing.ts`:

```ts
/** Where to send someone back to after they sign in. Keeps the query string,
 *  because a Paystack return carries its reference there and losing it breaks
 *  the payment-verify fallback. Bouncing back to /login would loop, so that
 *  one case resolves to the default. */
export function intendedPath(pathname: string, search: string): string {
  if (pathname === "/login") return POST_LOGIN_PATH;
  return `${pathname}${search}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/auth/__tests__/routing.test.ts -t intendedPath`
Expected: PASS.

- [ ] **Step 5: Forward the query string from middleware**

In `middleware.ts`, add below the existing `x-pathname` line:

```ts
  request.headers.set("x-search", request.nextUrl.search);
```

- [ ] **Step 6: Capture the destination in the app layout**

In `app/(app)/layout.tsx`, the current line 26 is `if (!me.authenticated) redirect("/login");`. It runs *before* `rawPath` is read, so both the headers read and the redirect must move together. Replace the top of the function body so the headers are read first:

```ts
  const h = await headers();
  const rawPath = h.get("x-pathname");
  const pathname = rawPath ?? "/";

  const me = await getCurrentProfile();
  if (!me.authenticated) {
    const next = intendedPath(pathname, h.get("x-search") ?? "");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
```

Then delete the original `const rawPath = (await headers()).get("x-pathname");` and `const pathname = rawPath ?? "/";` lines further down, so they aren't declared twice. Add `intendedPath` to the existing `@/lib/auth/routing` import.

- [ ] **Step 7: Pass `next` into the login card**

In `app/(auth)/login/page.tsx`, widen the searchParams type and forward the value:

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <LoginCard linkError={error === "link"} next={next} />
    </main>
  );
}
```

- [ ] **Step 8: Carry `next` through the OTP round trip**

In `app/(auth)/login/LoginCard.tsx`, change the signature to
`export function LoginCard({ linkError, next }: { linkError?: boolean; next?: string })`.

Add a hidden field inside **both** forms — the email form and the code form — so the destination survives the two-step flow:

```tsx
<input type="hidden" name="next" value={next ?? ""} />
```

Also raise the input font size so iOS doesn't zoom on focus. Change `fieldCls`:

```ts
  const fieldCls =
    "w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-base md:text-sm text-ink outline-none transition-colors focus:border-faint";
```

- [ ] **Step 9: Honour `next` on successful sign-in**

In `app/(auth)/login/actions.ts`:

Add `safeNext` to the `@/lib/auth/routing` import. In `requestCode`, read the field and return it so it survives into the code step — extend `ActionState` with `next?: string`:

```ts
export type ActionState = { error?: string; codeSent?: boolean; email?: string; next?: string };
```

In `requestCode`, capture `const next = String(formData.get("next") ?? "");` and include `next` in every returned object.

In `verifyCode`, replace the final line:

```ts
  redirect(safeNext(String(formData.get("next") ?? "") || null));
}
```

- [ ] **Step 10: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add middleware.ts lib/auth/routing.ts lib/auth/__tests__/routing.test.ts \
  "app/(app)/layout.tsx" "app/(auth)/login/page.tsx" \
  "app/(auth)/login/LoginCard.tsx" "app/(auth)/login/actions.ts"
git commit -m "feat(auth): preserve the intended destination through sign-in

A client clicking an emailed quote link while signed out lost the destination
entirely and landed on the default page. The path and its query string now
survive the OTP round trip, guarded by safeNext(). Fixes desktop too."
```

---

### Task 3: One navigation source for sidebar and mobile

The sidebar's entitlement filtering currently lives inline in `AppShell` (lines 55-63). Extracting it is what makes "mobile can't show something desktop hides" a guarantee rather than a hope.

**Files:**
- Modify: `lib/nav.ts`
- Create: `lib/__tests__/nav.test.ts`
- Modify: `components/AppShell.tsx:55-63`
- Modify: `components/MobileTabBar.tsx`
- Create: `app/(app)/more/page.tsx`

**Interfaces:**
- Consumes: `NAV`, `PENDING_NAV`, `NavItem`, `NavGroup` (existing), `FEATURE_HREFS` from `lib/feature-access`.
- Produces:
  - `MOBILE_TABS: NavItem[]` — replaces the deleted `MOBILE_NAV`.
  - `visibleNavGroups(opts: { role: UserRole; allowedHrefs?: string[]; billingEnabled?: boolean; pendingMode?: "pending" | "rejected" }): NavGroup[]`
  - `mobileMenuGroups(opts: same as above): NavGroup[]` — `visibleNavGroups` minus anything already a tab.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { visibleNavGroups, mobileMenuGroups, MOBILE_TABS } from "../nav";

const hrefs = (gs: { items: { href: string }[] }[]) => gs.flatMap((g) => g.items.map((i) => i.href));

describe("visibleNavGroups", () => {
  it("gives a manager their full nav when nothing is restricted", () => {
    const got = hrefs(visibleNavGroups({ role: "client_manager", billingEnabled: true }));
    expect(got).toContain("/quotes");
    expect(got).toContain("/billing");
  });

  it("drops billing when the client has no Xero link", () => {
    const got = hrefs(visibleNavGroups({ role: "client_manager", billingEnabled: false }));
    expect(got).not.toContain("/billing");
  });

  it("honours per-user feature overrides", () => {
    const got = hrefs(
      visibleNavGroups({ role: "client_manager", allowedHrefs: ["/support"], billingEnabled: true }),
    );
    expect(got).not.toContain("/quotes");
    expect(got).toContain("/support");
  });

  it("gives a pending user status only", () => {
    const got = hrefs(visibleNavGroups({ role: "client_member", pendingMode: "pending" }));
    expect(got).toEqual(["/status"]);
  });

  it("gives a rejected user nothing", () => {
    expect(visibleNavGroups({ role: "client_member", pendingMode: "rejected" })).toEqual([]);
  });

  it("drops groups that end up empty", () => {
    const groups = visibleNavGroups({ role: "client_manager", allowedHrefs: [], billingEnabled: false });
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe("mobileMenuGroups", () => {
  it("excludes anything already reachable as a tab", () => {
    const got = hrefs(mobileMenuGroups({ role: "client_manager", billingEnabled: true }));
    for (const tab of MOBILE_TABS) expect(got).not.toContain(tab.href);
  });

  it("still hides what the user isn't entitled to", () => {
    const got = hrefs(
      mobileMenuGroups({ role: "client_manager", allowedHrefs: ["/support"], billingEnabled: true }),
    );
    expect(got).not.toContain("/quotes");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/__tests__/nav.test.ts`
Expected: FAIL — no export named `visibleNavGroups`.

- [ ] **Step 3: Implement in `lib/nav.ts`**

Delete the `MOBILE_NAV` export entirely and replace it with the following. Add `import { FEATURE_HREFS } from "@/lib/feature-access";` at the top.

```ts
/** The four tabs on a phone. Home is the needs-you list, so it earns its slot;
 *  everything else lives behind More. Kept here rather than in the tab bar so
 *  "what mobile leads with" is one editable place. */
export const MOBILE_TABS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Tickets", href: "/support" },
  { label: "Status", href: "/status" },
  { label: "More", href: "/more" },
];

type NavOpts = {
  role: UserRole;
  allowedHrefs?: string[];
  billingEnabled?: boolean;
  pendingMode?: "pending" | "rejected";
};

/** The nav this user is actually entitled to. Single source of truth for the
 *  desktop sidebar and the mobile More page — if these two ever computed
 *  entitlement separately, a feature hidden on desktop could leak on mobile. */
export function visibleNavGroups({
  role,
  allowedHrefs,
  billingEnabled = false,
  pendingMode,
}: NavOpts): NavGroup[] {
  const gated = new Set(Object.values(FEATURE_HREFS));
  const allowed = new Set(allowedHrefs ?? [...gated]);
  if (!billingEnabled) allowed.delete("/billing"); // needs a Xero link too
  // No company: neither the role nav nor feature filtering means anything.
  const source = pendingMode ? (pendingMode === "pending" ? PENDING_NAV : []) : NAV[role];
  return source
    .map((g) => ({ ...g, items: g.items.filter((i) => !gated.has(i.href) || allowed.has(i.href)) }))
    .filter((g) => g.items.length > 0);
}

/** What the More page lists: everything they're entitled to that isn't already
 *  a tab. */
export function mobileMenuGroups(opts: NavOpts): NavGroup[] {
  const tabs = new Set(MOBILE_TABS.map((t) => t.href));
  return visibleNavGroups(opts)
    .map((g) => ({ ...g, items: g.items.filter((i) => !tabs.has(i.href)) }))
    .filter((g) => g.items.length > 0);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/__tests__/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `AppShell` consume the shared function**

In `components/AppShell.tsx`, delete lines 55-63 (the `gated` / `allowed` / `source` / `groups` block) and replace with:

```tsx
  const groups = visibleNavGroups({ role, allowedHrefs, billingEnabled, pendingMode });
```

Update the import on line 6 to `import { visibleNavGroups } from "@/lib/nav";` and remove the now-unused `NAV`, `PENDING_NAV`, and `FEATURE_HREFS` imports if nothing else in the file uses them.

- [ ] **Step 6: Update the tab bar to four tabs**

In `components/MobileTabBar.tsx`, change the import to `MOBILE_TABS` and map over it. Replace the comment and the active rule — Home is `/` and must match exactly, or it would light up on every page:

```tsx
/** Fixed four-tab bar — the primary navigation on a phone. Hidden at md+ where
 *  the sidebar takes over. Prefix match keeps Tickets lit inside a thread;
 *  Home is exact, or every route would light it. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {MOBILE_TABS.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors ${
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

- [ ] **Step 7: Build the More page**

Create `app/(app)/more/page.tsx`. It recomputes entitlement the same way the layout does, so it can't show more than the sidebar would.

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { allowedFeatures, toOverrides, FEATURE_HREFS } from "@/lib/feature-access";
import { hasConnectivity } from "@/lib/views/connectivity";
import { createClient } from "@/lib/supabase/server";
import { mobileMenuGroups } from "@/lib/nav";
import { PageHeader } from "@/components/ui";

/** Everything that isn't a tab, for phones. Hidden at md+ — the desktop
 *  sidebar already lists all of this, so the route exists but is unreachable
 *  by navigation there. */
export default async function MorePage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");

  let billingEnabled = false;
  let connectivityEnabled = false;
  if (me.profile.client_id) {
    const supabase = await createClient();
    const [{ data: client }, hasLines] = await Promise.all([
      supabase.from("clients").select("xero_contact_id").eq("id", me.profile.client_id).maybeSingle(),
      hasConnectivity(me.profile.client_id),
    ]);
    billingEnabled = !!client?.xero_contact_id;
    connectivityEnabled = hasLines;
  }

  const allowed = allowedFeatures(me.profile.role, toOverrides(me.profile.feature_overrides));
  if (!connectivityEnabled) allowed.delete("connectivity");

  const groups = mobileMenuGroups({
    role: me.profile.role,
    allowedHrefs: [...allowed].map((f) => FEATURE_HREFS[f]),
    billingEnabled,
  });

  return (
    <div className="space-y-6 md:hidden">
      <PageHeader title="More" subtitle="Everything else in your account." />
      {groups.map((g) => (
        <section key={g.label || "main"}>
          {g.label && (
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.6px] text-faint">
              {g.label}
            </h2>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="flex min-h-[52px] items-center justify-between border-b border-line-soft px-4 text-[15px] font-medium text-ink last:border-0"
              >
                {item.label}
                <span aria-hidden className="text-faint">
                  {item.external ? "↗" : "›"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green. If `tsc` reports stale `.next` duplicates, run `find .next -name "* 2.*" -delete` first.

- [ ] **Step 9: Commit**

```bash
git add lib/nav.ts lib/__tests__/nav.test.ts components/AppShell.tsx \
  components/MobileTabBar.tsx "app/(app)/more/page.tsx"
git commit -m "feat(nav): four mobile tabs plus a More page, from one shared source

Extracts the sidebar's entitlement filtering out of AppShell into tested
visibleNavGroups()/mobileMenuGroups(), so the mobile menu is computed from the
same rules as desktop and can't expose a section desktop hides. Replaces the
two hard-coded MOBILE_NAV items; nothing is hidden from mobile any more."
```

---

### Task 4: The needs-you data layer

Pure selection logic plus the one query that doesn't exist yet. Kept separate from rendering so the rules are testable without a database.

**Files:**
- Modify: `lib/views/subscriptions.ts`
- Create: `lib/needs-you.ts`
- Create: `lib/__tests__/needs-you.test.ts`

**Interfaces:**
- Consumes: `QuoteListRow` from `lib/views/quotes`, `AgreementRow` from `lib/views/agreements`, `TicketSummary` from `lib/freescout`.
- Produces:
  - `getFailedSubscriptions(clientId: string): Promise<{ id: string; quoteId: string }[]>`
  - `type NeedsYouItem = { kind: "quote" | "agreement" | "payment" | "ticket"; href: string; title: string; detail: string; urgent: boolean }`
  - `buildNeedsYou(input: NeedsYouInput): NeedsYouItem[]`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/needs-you.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNeedsYou } from "../needs-you";

const quote = {
  id: "q1", quoteNumber: "Q-2026-0143", title: "Firewall replacement",
  status: "sent" as const, grandTotal: 48290, monthlyTotal: null,
  validUntil: "2026-08-19", createdAt: "2026-08-11",
};
const agreement = {
  id: "a1", reference: "AG-004", title: "Managed Services Agreement",
  status: "sent", clientId: "c1", clientName: "Networkers", createdAt: "2026-08-11",
  sentAt: "2026-08-11", signedAt: null, signerName: null, signerEmail: null, hasPdf: true,
};
const ticket = {
  id: 5, number: 1042, subject: "Printer offline", status: "active",
  preview: "The reception printer…", customerEmail: "a@b.co.za", updatedAt: "2026-08-12",
};
const empty = { quotes: [], agreements: [], failedPayments: [], tickets: [] };

describe("buildNeedsYou", () => {
  it("returns nothing when nothing is outstanding", () => {
    expect(buildNeedsYou(empty)).toEqual([]);
  });

  it("surfaces a quote awaiting decision", () => {
    const [item] = buildNeedsYou({ ...empty, quotes: [quote] });
    expect(item.kind).toBe("quote");
    expect(item.href).toBe("/quotes/q1");
    expect(item.title).toBe("Firewall replacement");
  });

  it("ignores quotes that aren't awaiting a decision", () => {
    for (const status of ["accepted", "rejected", "expired", "draft"] as const) {
      expect(buildNeedsYou({ ...empty, quotes: [{ ...quote, status }] })).toEqual([]);
    }
  });

  it("surfaces an unsigned agreement and ignores a signed one", () => {
    expect(buildNeedsYou({ ...empty, agreements: [agreement] })).toHaveLength(1);
    expect(
      buildNeedsYou({ ...empty, agreements: [{ ...agreement, signedAt: "2026-08-12" }] }),
    ).toEqual([]);
  });

  it("surfaces open tickets but not closed ones", () => {
    expect(buildNeedsYou({ ...empty, tickets: [ticket] })).toHaveLength(1);
    expect(buildNeedsYou({ ...empty, tickets: [{ ...ticket, status: "closed" }] })).toEqual([]);
  });

  it("puts a failed payment first — money problems outrank everything", () => {
    const items = buildNeedsYou({
      ...empty,
      quotes: [quote],
      tickets: [ticket],
      failedPayments: [{ id: "s1", quoteId: "q1" }],
    });
    expect(items[0].kind).toBe("payment");
    expect(items[0].urgent).toBe(true);
    expect(items[0].href).toBe("/quotes/q1/pay");
  });

  it("orders the rest: quotes, then agreements, then tickets", () => {
    const items = buildNeedsYou({
      ...empty, quotes: [quote], agreements: [agreement], tickets: [ticket],
    });
    expect(items.map((i) => i.kind)).toEqual(["quote", "agreement", "ticket"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/__tests__/needs-you.test.ts`
Expected: FAIL — cannot find module `../needs-you`.

- [ ] **Step 3: Implement `lib/needs-you.ts`**

```ts
import type { QuoteListRow } from "@/lib/views/quotes";
import type { AgreementRow } from "@/lib/views/agreements";
import type { TicketSummary } from "@/lib/freescout";

export type NeedsYouItem = {
  kind: "quote" | "agreement" | "payment" | "ticket";
  href: string;
  title: string;
  detail: string;
  /** Renders in the brand tint rather than plain — money and outages only. */
  urgent: boolean;
};

export type NeedsYouInput = {
  quotes: QuoteListRow[];
  agreements: AgreementRow[];
  failedPayments: { id: string; quoteId: string }[];
  tickets: TicketSummary[];
};

/** What's waiting on this person, most consequential first. Pure so the rules
 *  are testable without a database — and because this same list becomes the
 *  push-notification set in the mobile app, where getting the ordering wrong
 *  is a lot more annoying than on a web page. */
export function buildNeedsYou(input: NeedsYouInput): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  // Money first: a failed debit order stops service.
  for (const p of input.failedPayments) {
    items.push({
      kind: "payment",
      href: `/quotes/${p.quoteId}/pay`,
      title: "Payment problem",
      detail: "Your last monthly payment didn't go through.",
      urgent: true,
    });
  }

  for (const q of input.quotes) {
    if (q.status !== "sent") continue;
    items.push({
      kind: "quote",
      href: `/quotes/${q.id}`,
      title: q.title,
      detail: q.validUntil ? `${q.quoteNumber} · valid until ${q.validUntil}` : q.quoteNumber,
      urgent: false,
    });
  }

  for (const a of input.agreements) {
    if (a.signedAt) continue;
    items.push({
      kind: "agreement",
      href: `/agreements/${a.id}`,
      title: a.title,
      detail: `${a.reference} · signature needed`,
      urgent: false,
    });
  }

  for (const t of input.tickets) {
    if (t.status === "closed") continue;
    items.push({
      kind: "ticket",
      href: `/support/${t.id}`,
      title: t.subject,
      detail: `#${t.number}`,
      urgent: false,
    });
  }

  return items;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run lib/__tests__/needs-you.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the failed-payment query**

Append to `lib/views/subscriptions.ts`:

```ts
/** Subscriptions stuck in 'failed' for one client. Service client, matching
 *  getSubscriptionForQuote above — quote_subscriptions carries client_id, so
 *  the scope is explicit here rather than relying on RLS. */
export async function getFailedSubscriptions(
  clientId: string,
): Promise<{ id: string; quoteId: string }[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("quote_subscriptions")
    .select("id, quote_id")
    .eq("client_id", clientId)
    .eq("status", "failed");
  return (data ?? []).map((r) => ({ id: r.id, quoteId: r.quote_id }));
}
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add lib/needs-you.ts lib/__tests__/needs-you.test.ts lib/views/subscriptions.ts
git commit -m "feat(home): needs-you selection logic and failed-payment query

Pure builder so the ordering rules are testable without a database. Money
first, then quotes, agreements, tickets — the same ordering the mobile app
will use for push notifications."
```

---

### Task 5: `NeedsYou` on Home

**Files:**
- Create: `components/NeedsYou.tsx`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `buildNeedsYou`, `NeedsYouItem` (Task 4); `getVisibleQuotes`, `getAgreements`, `getFailedSubscriptions`, `getSupportScope` + `listConversationsByEmail`/`listRecentConversations` + `filterConversations` (all already imported by `app/(app)/page.tsx`).
- Produces: `<NeedsYou items={NeedsYouItem[]} />`.

- [ ] **Step 1: Build the component**

Create `components/NeedsYou.tsx`:

```tsx
import Link from "next/link";
import type { NeedsYouItem } from "@/lib/needs-you";

const KIND_LABEL: Record<NeedsYouItem["kind"], string> = {
  payment: "Action required",
  quote: "Awaiting approval",
  agreement: "Signature needed",
  ticket: "Open ticket",
};

/** What's waiting on this person. Renders on phone and desktop alike — an
 *  empty state here is good news, so it reads as reassurance rather than as
 *  an error. */
export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-card px-4 py-5">
        <p className="text-sm text-muted">
          Nothing needs your attention right now. We&rsquo;ll email you if that changes.
        </p>
      </div>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.6px] text-faint">
        Needs you
      </h2>
      <div className="space-y-2.5">
        {items.map((item) => (
          <Link
            key={`${item.kind}-${item.href}`}
            href={item.href}
            className={`block rounded-lg border px-4 py-3.5 transition-colors ${
              item.urgent
                ? "border-warn-line bg-warn-tint hover:bg-warn-tint-2"
                : "border-line bg-card hover:border-faint"
            }`}
          >
            <span
              className={`text-[10.5px] font-semibold uppercase tracking-[0.4px] ${
                item.urgent ? "text-warn-ink" : "text-brand"
              }`}
            >
              {KIND_LABEL[item.kind]}
            </span>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
            <p className="mt-0.5 text-[13px] text-muted">{item.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into Home**

In `app/(app)/page.tsx`, add the imports:

```ts
import { getAgreements } from "@/lib/views/agreements";
import { getFailedSubscriptions } from "@/lib/views/subscriptions";
import { getVisibleQuotes } from "@/lib/views/quotes";
import { buildNeedsYou } from "@/lib/needs-you";
import { NeedsYou } from "@/components/NeedsYou";
```

Alongside the existing data fetches in the component body, gather the four inputs. Reuse whatever ticket list the page already builds rather than fetching FreeScout twice — the page already calls `getSupportScope` and one of `listConversationsByEmail`/`listRecentConversations`, then `filterConversations`; pass that same result in.

```tsx
  const clientId = me.profile.client_id;
  const [quotes, agreements, failedPayments] = clientId
    ? await Promise.all([
        getVisibleQuotes(clientId),
        getAgreements({ clientId }),
        getFailedSubscriptions(clientId),
      ])
    : [[], [], []];

  const needsYou = buildNeedsYou({ quotes, agreements, failedPayments, tickets });
```

Render `<NeedsYou items={needsYou} />` as the first element inside the page's root container, directly below the `PageHeader`.

- [ ] **Step 3: Hide the heavy cards on mobile**

Wrap the existing dashboard content — the device health card, stat grids, sparklines, M365 and billing blocks — in a single `<div className="hidden md:block space-y-6">`. Leave the markup inside untouched so desktop is byte-identical.

Add a comment above it recording the known limitation from the spec:

```tsx
      {/* Desktop-only. These queries still run on mobile — a server component
          can't see the viewport — so this saves page weight, not server time.
          If mobile Home proves slow, split the route rather than guessing. */}
```

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/NeedsYou.tsx "app/(app)/page.tsx"
git commit -m "feat(home): lead with what needs the client's attention

Home now opens with outstanding quotes, unsigned agreements, failed payments
and open tickets, on both phone and desktop. The existing dashboard cards move
below md: — they're the wrong altitude for a phone."
```

---

### Task 6: The quote document reflows

The reported bug. `QuoteDocument.module.css` is a literal A4 page; on a 375px viewport the fixed numeric columns (48+110+120px) exceed the available content width and collapse the description.

**Files:**
- Modify: `components/QuoteDocument.module.css`
- Modify: `components/QuoteDocument.tsx`

- [ ] **Step 1: Capture the print baseline before changing anything**

Open a real quote in the browser at desktop width, print to PDF, and save it outside the repo as the before-image. You cannot verify "print is unchanged" without this, and it must be captured first.

- [ ] **Step 2: Add data labels to the numeric cells**

In `components/QuoteDocument.tsx`, the line-item `<td>` elements using `s.cellNum` need labels so they stay meaningful once `thead` is hidden. Add `data-label` to each numeric cell in the `<tbody>` rows — `data-label="Qty"`, `data-label="Unit"`, `data-label="Total"` respectively — matching the column order declared in the `<colgroup>` at lines 67-72.

- [ ] **Step 3: Add the mobile block to the CSS module**

Append to `components/QuoteDocument.module.css`:

```css
/* ---- Phones. The page above is an A4 sheet: 210mm wide with 18mm padding and
   fixed 48/110/120px numeric columns. On a 375px viewport the padding alone
   eats ~136px and the numeric columns then exceed what's left, collapsing the
   description to nothing. Below 768px the tables become stacked cards.
   @media print re-asserts everything, so the PDF is untouched. ---- */
@media (max-width: 767px) {
  .page { padding: 14px; }

  .lines, .compTable { table-layout: auto; display: block; }
  .lines colgroup, .compTable colgroup { display: none; }
  .lines thead, .compTable thead { display: none; }
  .lines tbody, .lines tfoot,
  .compTable tbody, .compTable tfoot { display: block; }

  .lines tr, .compTable tr {
    display: block;
    padding: 9px 0;
    border-bottom: 1px solid var(--q-rule2);
  }
  .lines td, .compTable td {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0 !important;
    border-bottom: 0;
  }
  /* The description carries no label and gets the full width. */
  .lines td:first-child, .compTable td:first-child {
    display: block;
    font-weight: 650;
    margin-bottom: 3px;
  }
  .lines td[data-label]::before {
    content: attr(data-label);
    color: var(--q-ink2);
    font-weight: 400;
  }
  .cellNum { text-align: right; }
  .totLabel { text-align: left; padding-right: 0 !important; }
  .grandRow td { background: transparent; color: inherit; padding: 4px 0; }
  .grandRow { background: var(--accent); color: #fff; padding: 9px 11px; border-radius: 6px; }
  .brandLogo { width: 120px; }
  .projectIntro { font-size: 11px; }
}

/* The A4 sheet is what clients receive as a PDF — the mobile rules above must
   never reach it, regardless of the printing device's width. */
@media print {
  .page { padding: 18mm 18mm 22mm 18mm; }
  .lines, .compTable { display: table; table-layout: fixed; }
  .lines colgroup, .compTable colgroup { display: table-column-group; }
  .lines thead, .compTable thead { display: table-header-group; }
  .lines tbody, .compTable tbody { display: table-row-group; }
  .lines tfoot, .compTable tfoot { display: table-footer-group; }
  .lines tr, .compTable tr { display: table-row; padding: 0; border-bottom: 0; }
  .lines td, .compTable td { display: table-cell; }
  .lines td[data-label]::before { content: none; }
}
```

- [ ] **Step 4: Verify the phone rendering**

Start the dev server via `preview_start` (never `npm run dev` in Bash). Resize to 375px, open a real quote, and confirm: no horizontal scroll, every description legible, every amount visible and right-aligned, and the grand-total row still reads as the emphasised row.

- [ ] **Step 5: Verify print is unchanged**

Print the same quote to PDF at desktop width and compare against the Step 1 baseline. They must match. If they differ, the `@media print` block is incomplete — fix it before committing, do not accept "close enough". This is the artifact clients receive.

- [ ] **Step 6: Commit**

```bash
git add components/QuoteDocument.module.css components/QuoteDocument.tsx
git commit -m "fix(quotes): reflow the quote document below 768px

The document is a literal A4 sheet — 210mm wide, 18mm padding, fixed
48/110/120px numeric columns. On a 375px phone the description column
collapsed to nothing, which is why a client couldn't read an emailed quote.
Line items now stack as cards below md:. @media print re-asserts the table
layout, so the PDF clients receive is unchanged."
```

---

### Task 7: Decision furniture on the quote page

**Files:**
- Modify: `app/(app)/quotes/[id]/page.tsx`
- Modify: `app/(app)/quotes/[id]/QuoteActions.tsx`

- [ ] **Step 1: Add the price header**

In `app/(app)/quotes/[id]/page.tsx`, directly below the `print:hidden` `PageHeader` block (lines 148-163), add a mobile-only summary so the number and the deadline are visible without scrolling the whole document:

```tsx
      {/* Phone: the two facts someone decides on, above the document. Desktop
          gets them from the document itself without scrolling. */}
      <div className="rounded-lg border border-line bg-card px-4 py-3.5 md:hidden print:hidden">
        <p className="text-[22px] font-bold leading-none tracking-[-0.5px] text-ink">
          {fmtMoney(quote.grandTotal)}
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          incl VAT · valid until {quote.doc.meta.validUntil}
        </p>
      </div>
```

`doc.meta.validUntil` is a non-nullable `string` (`lib/quotes/doc.ts:49`), so it needs no conditional.

- [ ] **Step 2: Make the actions sticky on mobile**

`app/(app)/quotes/[id]/QuoteActions.tsx:80` is `<div className="space-y-3 print:hidden">`, wrapping a `flex flex-wrap` button row at line 81. Only that inner button row pins — the checkout explainer block below it (line 127) must keep flowing with the page, or it would be trapped in a fixed bar.

Change line 81 from:

```tsx
      <div className="flex flex-wrap items-center gap-2">
```

to:

```tsx
      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 flex flex-wrap items-center gap-2 border-t border-line bg-card px-4 py-3 md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent md:px-0 md:py-0">
```

The tab bar from Task 3 is `z-40` at 56px plus safe-area inset, so `bottom-[calc(56px+…)]` with `z-50` sits directly above it without overlap. Give each `<button>` in that row `min-h-[44px] flex-1 md:flex-none`.

- [ ] **Step 3: Add bottom clearance**

The page's root container needs padding so the document's last rows aren't hidden behind the sticky bar. Change the root `<div className="space-y-5">` to `<div className="space-y-5 pb-32 md:pb-0">`.

- [ ] **Step 4: Verify at 375px**

With the dev server running, open a quote with status `sent` as a client manager. Confirm: the action bar is visible without scrolling, sits above the tab bar without overlapping it, the last line of the document is reachable, and both buttons are ≥44px tall. Then confirm a quote with any other status shows no action bar and no wasted padding.

- [ ] **Step 5: Verify desktop is unmoved**

At 1280px the actions must render exactly where they do today — inline, not fixed.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/quotes/[id]/page.tsx" "app/(app)/quotes/[id]/QuoteActions.tsx"
git commit -m "feat(quotes): price header and sticky actions on mobile

Approve/Decline pins above the tab bar on a phone so it's reachable without
scrolling to the end of a long quote, and the total and expiry sit above the
document. Desktop is unchanged."
```

---

### Task 8: Light passes on the remaining emailed destinations

"Light pass" per the spec: no horizontal overflow at 375px, tap targets ≥ 44px, text inputs ≥ 16px, long strings wrapped not truncated. Not a redesign — if one of these needs a redesign, stop and raise it.

**Files:**
- Modify: `app/(app)/agreements/[id]/SignBlock.tsx:29`
- Modify: `app/(app)/quotes/[id]/pay/page.tsx`
- Modify: `app/(app)/support/bookings/[id]/page.tsx`
- Modify: `app/(app)/communications/page.tsx`

- [ ] **Step 1: Fix the signature input**

`app/(app)/agreements/[id]/SignBlock.tsx:29` uses `text-sm` — 14px, so iOS zooms the viewport when someone taps it to sign a binding document. Change to `text-base md:text-sm`. Give the submit button `min-h-[44px] w-full md:w-auto`.

- [ ] **Step 2: Audit the pay page**

`app/(app)/quotes/[id]/pay/page.tsx:61` — the button is already `w-full`. Confirm at 375px that the amount summary doesn't overflow and the button clears 44px. Paystack hosts the card form, so nothing else here is ours.

- [ ] **Step 3: Audit the two unaudited pages**

Open `app/(app)/support/bookings/[id]/page.tsx` and `app/(app)/communications/page.tsx` at 375px. Apply the light-pass rules. Typical fixes, matching what was done on `/support` previously: `flex-wrap` on rows that put a label and a timestamp on one line, `break-words` on user-supplied text, and stacking two-column grids below `md:`.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/agreements/[id]/SignBlock.tsx" "app/(app)/quotes/[id]/pay/page.tsx" \
  "app/(app)/support/bookings/[id]/page.tsx" "app/(app)/communications/page.tsx"
git commit -m "fix(mobile): light pass on the remaining emailed destinations

The signature input was 14px, so iOS zoomed the viewport when someone tapped
it to sign. Plus wrapping and tap-target fixes on the booking, payment and
communications pages."
```

---

### Task 9: End-to-end verification

Every prior task verified a page. This verifies the *journey*, which is what actually broke — no page was individually broken enough to explain the bug.

**Files:** none — verification only.

- [ ] **Step 1: Generate a magic link for a real client**

Use the existing script pattern with the service role key from `.env.local` to generate a link for a `client_manager` on a client that has a quote in `sent` status. Do not create or modify client data — the dev server points at production.

- [ ] **Step 2: Walk the broken journey at 375px**

Resize to 375px. **Signed out**, navigate directly to `/quotes/{id}` for a real quote. Confirm each step:

1. You are redirected to `/login?next=%2Fquotes%2F{id}`.
2. The email field does not zoom the viewport when focused.
3. After the code, you land on **`/quotes/{id}`** — not `/status`.
4. The quote is readable: no horizontal scroll, descriptions and amounts legible.
5. Approve/Decline is reachable without scrolling to the end.

This is the exact path the client reported. If any step fails, the feature is not done.

- [ ] **Step 3: Walk the same journey signed in**

From Home, confirm the quote appears under "Needs you" and tapping it opens the same page. Confirm all four tabs work and More lists everything the desktop sidebar shows for that user.

- [ ] **Step 4: Confirm entitlement holds on mobile**

Sign in as a user with a feature override that removes a section. Confirm it is absent from **both** the desktop sidebar and the mobile More page. This is the leak the shared `visibleNavGroups` exists to prevent.

- [ ] **Step 5: Desktop regression sweep at 1280px**

Visit `/`, `/support`, `/quotes/{id}`, `/agreements/{id}`, `/status`. Nothing may have moved except the new `NeedsYou` block on Home. `/more` renders nothing at desktop width.

- [ ] **Step 6: Confirm the print artifact one final time**

Print the same quote to PDF and diff against the Task 6 Step 1 baseline.

- [ ] **Step 7: Full verification and push**

```bash
npm test && npx tsc --noEmit && npm run build
```

All three must pass. Then push to `preview` and confirm the deployment is healthy.

```bash
git push origin preview
```

- [ ] **Step 8: Report honestly**

State what was verified and how, and name anything skipped or left failing. If `/support/bookings/{id}` or `/communications` needed more than a light pass, say so explicitly rather than absorbing the extra work silently.

---

## Deferred to Project 2 (Expo)

Not in this plan; recorded so the handoff is understood:

- Quote accept/reject, Paystack initiation, and FreeScout ticket creation live in server actions that native cannot call. They become RPCs or Edge Functions — Project 2's first task.
- `MOBILE_TABS` becomes Expo Router's tab layout.
- `buildNeedsYou` becomes both the app home screen and the push-notification payload set.
- Auth is already 6-digit OTP, so native sign-in needs no deep-link or OAuth plumbing.
