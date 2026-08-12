# Connectivity Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal the Connectivity section to the 66 managers who have it switched off, target a Portal Update at exactly the people who can see it, and turn the `/connectivity` empty state into an enquiry that raises an RFQ.

**Architecture:** Three separable pieces. (1) A pure partition function (`lib/views/recipient-partition.ts`) that splits portal users into eligible / opted-out / excluded given a feature or service filter — `lib/views/portal-updates.ts` becomes a thin data-loading wrapper around it. (2) A pure enquiry payload builder (`lib/connectivity-enquiry.ts`) plus a service-role server action that writes one `rfqs` row with the caller's own `client_id` forced, and a client component rendering the pitch + form in place of today's dead-end empty state. (3) A one-off `--dry-run`-by-default script that clears `connectivity` from `profiles.feature_overrides`.

**Tech Stack:** Next.js 16 App Router (server components + server actions, `useActionState`), Supabase (RLS client for reads, service client for the `rfqs` write), vitest for the pure modules, Tailwind for UI.

## Global Constraints

- Supabase project ref is **`eskhokedsximnslgsycs`**. Never `qomxwxxulxcwnpaqzudl`.
- All development commits directly to `main`. Conventional commit messages.
- Pure logic lives in import-free modules with a vitest file beside it. **Vitest must never import `@/lib/supabase/server`.**
- The `rfqs` table is staff-only under RLS. A client user must never be given write access to it — the enquiry writes via the service client, in a server action that has already verified the caller and forced `client_id` to the caller's own.
- Feature access is **subtractive only**: `overrides` can remove a role default, never grant one. Members default to no features and are **out of scope** for this campaign.
- The opt-out guarantee lives in `lib/email/send.ts`. Nothing in this plan may weaken it; the targeting helper only *previews* who would be mailed.
- No prices or packages on the connectivity page — SA connectivity pricing is address-dependent.
- Run `npm test && npm run build` before any push. If `npx tsc --noEmit` reports bogus duplicate identifiers, run `find .next -name "* 2.*" -delete` first.

---

### Task 1: Feature-aware recipient partition

**Files:**
- Create: `lib/views/recipient-partition.ts`
- Create: `lib/views/recipient-partition.test.ts`
- Modify: `lib/views/portal-updates.ts` (whole file rewritten to call the new module)

**Interfaces:**
- Consumes: `canAccess(role: string, overrides: Overrides, feature: string): boolean` and `toOverrides(v: unknown): Overrides` from `@/lib/feature-access`.
- Produces:
  - `type Recipient = { email: string; name: string; clientName: string }`
  - `type ExcludedRecipient = Recipient & { reason: "no_feature" | "no_service" }`
  - `type PartitionRow = { email: string; name: string; clientName: string; clientId: string | null; role: string; overrides: unknown; optedOut: boolean }`
  - `partitionRecipients(rows: PartitionRow[], opts?: { feature?: string; clientIdsWithService?: Set<string> }): { eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] }`
  - `getPortalUpdateRecipients(opts?: { clientId?: string; feature?: string; hasService?: "connectivity" }): Promise<{ eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] }>`

**Ordering rule (decide once, test it):** exclusion is checked **before** opt-out. Someone who cannot see the section is `excluded`, even if they also opted out — they were never in the audience, so counting them as "opted out" would overstate how many people refused the mail.

- [ ] **Step 1: Write the failing test**

Create `lib/views/recipient-partition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { partitionRecipients, type PartitionRow } from "./recipient-partition";

const row = (over: Partial<PartitionRow> = {}): PartitionRow => ({
  email: "a@x.com",
  name: "A",
  clientName: "Acme",
  clientId: "c1",
  role: "client_manager",
  overrides: null,
  optedOut: false,
  ...over,
});

describe("partitionRecipients", () => {
  it("puts a plain manager in eligible when there is no filter", () => {
    const out = partitionRecipients([row()]);
    expect(out.eligible.map((r) => r.email)).toEqual(["a@x.com"]);
    expect(out.optedOut).toEqual([]);
    expect(out.excluded).toEqual([]);
  });

  it("moves an opted-out person out of eligible", () => {
    const out = partitionRecipients([row({ optedOut: true })]);
    expect(out.eligible).toEqual([]);
    expect(out.optedOut.map((r) => r.email)).toEqual(["a@x.com"]);
  });

  it("excludes a manager who has the feature switched off", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false } })], { feature: "connectivity" });
    expect(out.eligible).toEqual([]);
    expect(out.excluded).toEqual([
      { email: "a@x.com", name: "A", clientName: "Acme", reason: "no_feature" },
    ]);
  });

  it("excludes every member when a feature filter is set, since members default to none", () => {
    const out = partitionRecipients([row({ role: "client_member" })], { feature: "connectivity" });
    expect(out.eligible).toEqual([]);
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("keeps a manager whose overrides remove a DIFFERENT feature", () => {
    const out = partitionRecipients([row({ overrides: { billing: false } })], { feature: "connectivity" });
    expect(out.eligible.map((r) => r.email)).toEqual(["a@x.com"]);
  });

  it("excludes clients without the service when clientIdsWithService is given", () => {
    const rows = [row({ email: "has@x.com", clientId: "c1" }), row({ email: "not@x.com", clientId: "c2" })];
    const out = partitionRecipients(rows, { clientIdsWithService: new Set(["c1"]) });
    expect(out.eligible.map((r) => r.email)).toEqual(["has@x.com"]);
    expect(out.excluded).toEqual([
      { email: "not@x.com", name: "A", clientName: "Acme", reason: "no_service" },
    ]);
  });

  it("treats a null clientId as not having the service", () => {
    const out = partitionRecipients([row({ clientId: null })], { clientIdsWithService: new Set(["c1"]) });
    expect(out.excluded[0].reason).toBe("no_service");
  });

  // Exclusion wins over opt-out: someone who cannot see the page was never in
  // the audience, so counting them as "opted out" would overstate refusals.
  it("reports someone who is both invisible and opted out as excluded, not optedOut", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false }, optedOut: true })], {
      feature: "connectivity",
    });
    expect(out.optedOut).toEqual([]);
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("checks the feature before the service so the reason is the more specific one", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false }, clientId: "c2" })], {
      feature: "connectivity",
      clientIdsWithService: new Set(["c1"]),
    });
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("sorts each bucket by client then name", () => {
    const rows = [
      row({ email: "z@x.com", name: "Zoe", clientName: "Beta" }),
      row({ email: "a@x.com", name: "Amy", clientName: "Beta" }),
      row({ email: "m@x.com", name: "Mo", clientName: "Alpha" }),
    ];
    const out = partitionRecipients(rows);
    expect(out.eligible.map((r) => r.email)).toEqual(["m@x.com", "a@x.com", "z@x.com"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ email: "b@x.com" }), row({ email: "a@x.com" })];
    const before = rows.map((r) => r.email);
    partitionRecipients(rows);
    expect(rows.map((r) => r.email)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx vitest run lib/views/recipient-partition.test.ts
```

Expected: FAIL — `Failed to resolve import "./recipient-partition"`.

- [ ] **Step 3: Write the implementation**

Create `lib/views/recipient-partition.ts`:

```ts
/** Who a Portal Update would actually reach — pure, no server imports
 *  (vitest-safe). The data loading lives in ./portal-updates.ts.
 *
 *  Three buckets, and the order of the checks is the point:
 *  `excluded` (can't see the section / doesn't have the service) is decided
 *  BEFORE `optedOut`, because someone who cannot open the page was never in
 *  the audience — filing them under "opted out" would overstate refusals. */
import { canAccess, toOverrides } from "@/lib/feature-access";

export type Recipient = { email: string; name: string; clientName: string };
export type ExcludedRecipient = Recipient & { reason: "no_feature" | "no_service" };

export type PartitionRow = {
  email: string;
  name: string;
  clientName: string;
  clientId: string | null;
  role: string;
  /** Raw profiles.feature_overrides jsonb — narrowed here. */
  overrides: unknown;
  optedOut: boolean;
};

const byClientThenName = (a: Recipient, b: Recipient) =>
  a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name);

export function partitionRecipients(
  rows: PartitionRow[],
  opts: { feature?: string; clientIdsWithService?: Set<string> } = {},
): { eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] } {
  const eligible: Recipient[] = [];
  const optedOut: Recipient[] = [];
  const excluded: ExcludedRecipient[] = [];

  for (const r of rows) {
    const person: Recipient = { email: r.email, name: r.name, clientName: r.clientName };
    if (opts.feature && !canAccess(r.role, toOverrides(r.overrides), opts.feature)) {
      excluded.push({ ...person, reason: "no_feature" });
      continue;
    }
    if (opts.clientIdsWithService && !(r.clientId && opts.clientIdsWithService.has(r.clientId))) {
      excluded.push({ ...person, reason: "no_service" });
      continue;
    }
    (r.optedOut ? optedOut : eligible).push(person);
  }

  return {
    eligible: eligible.sort(byClientThenName),
    optedOut: optedOut.sort(byClientThenName),
    excluded: excluded.sort(byClientThenName),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx vitest run lib/views/recipient-partition.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Rewrite the loader to use it**

Replace the whole of `lib/views/portal-updates.ts` with:

```ts
import { createClient } from "@/lib/supabase/server";
import {
  partitionRecipients,
  type ExcludedRecipient,
  type PartitionRow,
  type Recipient,
} from "./recipient-partition";

export type { Recipient, ExcludedRecipient };

/** Who would receive a Portal Update, who has switched them off, and who was
 *  filtered out (and why). Staff-only by RLS. For previewing a send — the
 *  guarantee that opted-out people are excluded lives in lib/email/send.ts.
 *
 *  `feature` filters on real visibility (role defaults minus that user's
 *  overrides), so nobody is ever mailed about a page they cannot open.
 *  `hasService` filters on data — clients with an active service row. */
export async function getPortalUpdateRecipients(
  opts: { clientId?: string; feature?: string; hasService?: "connectivity" } = {},
): Promise<{ eligible: Recipient[]; optedOut: Recipient[]; excluded: ExcludedRecipient[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("profiles")
    .select("email, client_id, role, feature_overrides, portal_updates_opt_out, people(display_name)")
    .eq("status", "active")
    .in("role", ["client_manager", "client_member"]);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);

  const [{ data, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);

  let clientIdsWithService: Set<string> | undefined;
  if (opts.hasService === "connectivity") {
    const { data: svc, error: svcErr } = await supabase
      .from("connectivity_services")
      .select("client_id")
      .eq("is_active", true);
    if (svcErr) throw new Error(svcErr.message);
    clientIdsWithService = new Set((svc ?? []).map((s) => s.client_id));
  }

  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const rows: PartitionRow[] = (data ?? []).map((r) => {
    const person = Array.isArray(r.people) ? r.people[0] : r.people;
    return {
      email: r.email,
      name: (person as { display_name?: string } | null)?.display_name ?? r.email,
      clientName: r.client_id ? (clientName.get(r.client_id) ?? "—") : "—",
      clientId: r.client_id,
      role: r.role,
      overrides: r.feature_overrides,
      optedOut: Boolean(r.portal_updates_opt_out),
    };
  });

  return partitionRecipients(rows, { feature: opts.feature, clientIdsWithService });
}
```

Note the signature change: `getPortalUpdateRecipients(clientId)` is now `getPortalUpdateRecipients({ clientId })`. Confirm nothing else calls it:

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && grep -rn "getPortalUpdateRecipients" app lib scripts
```

Expected: only the definition in `lib/views/portal-updates.ts` and this new call site. If a caller appears, update it to the object form.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx tsc --noEmit
```

Expected: no errors. If it reports duplicate identifiers in `.next`, run `find .next -name "* 2.*" -delete` and repeat.

- [ ] **Step 7: Commit**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git add lib/views/recipient-partition.ts lib/views/recipient-partition.test.ts lib/views/portal-updates.ts && git commit -m "feat(email): feature- and service-aware Portal Update targeting"
```

---

### Task 2: Connectivity enquiry payload builder

**Files:**
- Create: `lib/connectivity-enquiry.ts`
- Create: `lib/connectivity-enquiry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EnquiryInput = { address: string; provider: string; speed: string; note: string; contactName: string; contactEmail: string }`
  - `type EnquiryPayload = { title: string; description: string; requestedBy: string }`
  - `buildEnquiry(clientName: string, input: EnquiryInput): { ok: true; payload: EnquiryPayload } | { ok: false; error: string }`

The builder owns validation and the exact RFQ text, so the wording is provable without a database. Optional fields arrive as `""` from a form, never `undefined`.

- [ ] **Step 1: Write the failing test**

Create `lib/connectivity-enquiry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildEnquiry, type EnquiryInput } from "./connectivity-enquiry";

const input = (over: Partial<EnquiryInput> = {}): EnquiryInput => ({
  address: "12 Long Street, Cape Town, 8001",
  provider: "",
  speed: "",
  note: "",
  contactName: "Sam Patel",
  contactEmail: "sam@acme.co.za",
  ...over,
});

describe("buildEnquiry", () => {
  it("titles the RFQ with the client name", () => {
    const out = buildEnquiry("Acme Legal", input());
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.title).toBe("Connectivity enquiry — Acme Legal");
  });

  it("names the contact and their email as requestedBy", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toBe("Sam Patel <sam@acme.co.za>");
  });

  it("puts the address in the description", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Site address: 12 Long Street, Cape Town, 8001");
  });

  it("omits optional lines that were left blank", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).not.toContain("Current provider");
    expect(out.payload.description).not.toContain("Current speed");
    expect(out.payload.description).not.toContain("Note");
  });

  it("includes the optional lines when they are given", () => {
    const out = buildEnquiry("Acme Legal", input({ provider: "Vuma", speed: "50/25 Mbps", note: "Line drops daily" }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Current provider: Vuma");
    expect(out.payload.description).toContain("Current speed: 50/25 Mbps");
    expect(out.payload.description).toContain("Note: Line drops daily");
  });

  it("trims whitespace from every field", () => {
    const out = buildEnquiry("  Acme Legal  ", input({ address: "  12 Long Street  ", provider: "  Vuma  " }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.title).toBe("Connectivity enquiry — Acme Legal");
    expect(out.payload.description).toContain("Site address: 12 Long Street");
    expect(out.payload.description).toContain("Current provider: Vuma");
  });

  it("rejects a blank address", () => {
    expect(buildEnquiry("Acme Legal", input({ address: "   " }))).toEqual({
      ok: false,
      error: "Enter the address you'd like us to check.",
    });
  });

  it("rejects an address that is too short to look up", () => {
    expect(buildEnquiry("Acme Legal", input({ address: "12 Long" }))).toEqual({
      ok: false,
      error: "Enter the full street address, suburb and city so we can check coverage.",
    });
  });

  it("rejects a contact without an email", () => {
    expect(buildEnquiry("Acme Legal", input({ contactEmail: "nope" }))).toEqual({
      ok: false,
      error: "Enter a valid contact email address.",
    });
  });

  it("falls back to the email when no contact name is given", () => {
    const out = buildEnquiry("Acme Legal", input({ contactName: "  " }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toBe("sam@acme.co.za");
  });

  it("caps a very long note so one paste cannot flood the RFQ board", () => {
    const out = buildEnquiry("Acme Legal", input({ note: "x".repeat(3000) }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description.length).toBeLessThan(2200);
    expect(out.payload.description).toContain("…");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx vitest run lib/connectivity-enquiry.test.ts
```

Expected: FAIL — `Failed to resolve import "./connectivity-enquiry"`.

- [ ] **Step 3: Write the implementation**

Create `lib/connectivity-enquiry.ts`:

```ts
/** Turns a connectivity enquiry from the portal into the RFQ text a human
 *  reads on the admin board. Pure, no server imports (vitest-safe) — the
 *  wording is provable without a database.
 *
 *  Optional fields arrive from a form as "", never undefined. */

export type EnquiryInput = {
  address: string;
  provider: string;
  speed: string;
  note: string;
  contactName: string;
  contactEmail: string;
};

export type EnquiryPayload = { title: string; description: string; requestedBy: string };

const MAX_NOTE = 1200;

const clip = (s: string) => (s.length > MAX_NOTE ? `${s.slice(0, MAX_NOTE)}…` : s);

export function buildEnquiry(
  clientName: string,
  input: EnquiryInput,
): { ok: true; payload: EnquiryPayload } | { ok: false; error: string } {
  const address = input.address.trim();
  if (!address) return { ok: false, error: "Enter the address you'd like us to check." };
  if (address.length < 10) {
    return { ok: false, error: "Enter the full street address, suburb and city so we can check coverage." };
  }
  const email = input.contactEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid contact email address." };
  }

  const name = input.contactName.trim();
  const provider = input.provider.trim();
  const speed = input.speed.trim();
  const note = input.note.trim();

  const lines = [
    `Site address: ${clip(address)}`,
    provider ? `Current provider: ${clip(provider)}` : null,
    speed ? `Current speed: ${clip(speed)}` : null,
    note ? `Note: ${clip(note)}` : null,
    `Contact: ${name ? `${name} <${email}>` : email}`,
    "",
    "Raised from the portal's Connectivity page.",
  ].filter((l): l is string => l !== null);

  return {
    ok: true,
    payload: {
      title: `Connectivity enquiry — ${clientName.trim()}`,
      description: lines.join("\n"),
      requestedBy: name ? `${name} <${email}>` : email,
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx vitest run lib/connectivity-enquiry.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git add lib/connectivity-enquiry.ts lib/connectivity-enquiry.test.ts && git commit -m "feat(connectivity): enquiry payload builder"
```

---

### Task 3: Enquiry server action

**Files:**
- Create: `app/(app)/connectivity/actions.ts`

**Interfaces:**
- Consumes: `buildEnquiry(clientName, input)` from `@/lib/connectivity-enquiry`; `getCurrentProfile()` from `@/lib/auth/profile`; `canAccess`, `toOverrides` from `@/lib/feature-access`; `createServiceClient()` from `@/lib/supabase/service`; `notifyRfqCreated(opts)` from `@/lib/rfq-notify`.
- Produces: `type EnquiryResult = { ok: true } | { ok: false; error: string }` and
  `submitConnectivityEnquiry(_prev: EnquiryResult | null, formData: FormData): Promise<EnquiryResult>`,
  reading form fields `address`, `provider`, `speed`, `note`, `contact_name`, `contact_email`.

**Security shape (this is the whole point of the task):** `rfqs` is staff-only under RLS, so the insert uses the service client. Every guard therefore lives in this function: the caller must be an authenticated client user with a `client_id` and visible `connectivity`; `client_id` is taken from the session profile and never from the form; and a second `new` enquiry for the same client is refused.

- [ ] **Step 1: Write the action**

Create `app/(app)/connectivity/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { createServiceClient } from "@/lib/supabase/service";
import { buildEnquiry } from "@/lib/connectivity-enquiry";
import { notifyRfqCreated } from "@/lib/rfq-notify";

export type EnquiryResult = { ok: true } | { ok: false; error: string };

/**
 * A client asks us to check connectivity at their address; we raise an RFQ.
 *
 * `rfqs` is staff-only under RLS, so this writes with the service client —
 * which makes every guard below the security boundary, not a convenience:
 * the caller must be an authenticated client user who can see Connectivity,
 * and `client_id` comes from their session profile, never from the form. A
 * client can only ever raise an enquiry for their own company.
 */
export async function submitConnectivityEnquiry(
  _prev: EnquiryResult | null,
  formData: FormData,
): Promise<EnquiryResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.client_id) {
    return { ok: false, error: "Sign in with your company account to send an enquiry." };
  }
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) {
    return { ok: false, error: "Connectivity is not enabled for your account." };
  }
  const clientId = me.profile.client_id;
  const service = createServiceClient();

  const { data: client } = await service.from("clients").select("name").eq("id", clientId).maybeSingle();
  const built = buildEnquiry(client?.name ?? "your company", {
    address: String(formData.get("address") ?? ""),
    provider: String(formData.get("provider") ?? ""),
    speed: String(formData.get("speed") ?? ""),
    note: String(formData.get("note") ?? ""),
    contactName: String(formData.get("contact_name") ?? ""),
    contactEmail: String(formData.get("contact_email") ?? ""),
  });
  if (!built.ok) return { ok: false, error: built.error };

  // Rate limit: one open enquiry per client, so an eager click can't litter
  // the RFQ board. Matched on the title we generate, not on free text.
  const { data: existing } = await service
    .from("rfqs")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "new")
    .eq("title", built.payload.title)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "We already have your enquiry — we'll come back to you shortly." };
  }

  const { data: rfq, error } = await service
    .from("rfqs")
    .insert({
      title: built.payload.title,
      client_id: clientId,
      requested_by: built.payload.requestedBy,
      description: built.payload.description,
      status: "new",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Something went wrong sending that — please try again." };

  // Best-effort: Shawn hears about it, but a mail failure never loses the RFQ.
  try {
    await notifyRfqCreated({
      rfqId: rfq.id,
      title: built.payload.title,
      clientLabel: client?.name ?? null,
      requestedBy: built.payload.requestedBy,
      description: built.payload.description,
      creatorEmail: me.profile.email,
    });
  } catch (e) {
    console.error("connectivity enquiry notification failed:", e);
  }

  revalidatePath("/connectivity");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx tsc --noEmit
```

Expected: no errors. The form field names (`contact_name`, `contact_email`) deliberately differ from the `EnquiryInput` keys (`contactName`, `contactEmail`) — the mapping happens in this call and nowhere else.

- [ ] **Step 3: Commit**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git add "app/(app)/connectivity/actions.ts" && git commit -m "feat(connectivity): server action raising an enquiry RFQ"
```

---

### Task 4: The empty state that sells

**Files:**
- Create: `components/ConnectivityEnquiry.tsx`
- Modify: `app/(app)/connectivity/page.tsx` (the `lines.length === 0` branch)

**Interfaces:**
- Consumes: `submitConnectivityEnquiry` and `type EnquiryResult` from `@/app/(app)/connectivity/actions`; `Card` from `@/components/ui`.
- Produces: `<ConnectivityEnquiry contactName={string} contactEmail={string} />`.

A client with active lines sees exactly what they see today — only the empty branch changes.

- [ ] **Step 1: Write the component**

Create `components/ConnectivityEnquiry.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { submitConnectivityEnquiry, type EnquiryResult } from "@/app/(app)/connectivity/actions";
import { Card } from "@/components/ui";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

/** Shown on /connectivity when the client has no active lines. Replaces what
 *  used to be a dead end ("No connectivity services on your account yet.")
 *  with a pitch and a coverage enquiry that lands on the RFQ board.
 *
 *  No prices: SA connectivity pricing is address-dependent, so quoting blind
 *  would mislead. */
export function ConnectivityEnquiry({
  contactName,
  contactEmail,
}: {
  contactName: string;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<EnquiryResult | null, FormData>(
    submitConnectivityEnquiry,
    null,
  );

  if (state?.ok) {
    return (
      <Card>
        <div className="px-4 py-6">
          <p className="text-sm font-semibold text-ink">We've got it.</p>
          <p className="mt-1 text-sm text-muted">
            We'll check what's available at that address and come back to you with options.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-4 py-5">
        <p className="text-sm font-semibold text-ink">Connectivity from Rocking</p>
        <p className="mt-1.5 text-sm text-muted">
          Fibre, wireless and LTE — sourced, installed and managed by us. Once a line is live it shows up right
          here: speed, uptime and a call to us the moment it goes down.
        </p>

        <form action={formAction} className="mt-5 space-y-3.5">
          <label className="block">
            <span className={LABEL}>Site address</span>
            <input
              name="address"
              required
              placeholder="Street, suburb, city"
              className={FIELD}
              disabled={pending}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Current provider (optional)</span>
              <input name="provider" placeholder="e.g. Vuma" className={FIELD} disabled={pending} />
            </label>
            <label className="block">
              <span className={LABEL}>Current speed (optional)</span>
              <input name="speed" placeholder="e.g. 50/25 Mbps" className={FIELD} disabled={pending} />
            </label>
          </div>
          <label className="block">
            <span className={LABEL}>Anything else? (optional)</span>
            <textarea name="note" rows={3} className={FIELD} disabled={pending} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Who should we contact</span>
              <input name="contact_name" defaultValue={contactName} className={FIELD} disabled={pending} />
            </label>
            <label className="block">
              <span className={LABEL}>Contact email</span>
              <input
                name="contact_email"
                type="email"
                required
                defaultValue={contactEmail}
                className={FIELD}
                disabled={pending}
              />
            </label>
          </div>

          {state && !state.ok && <p className="text-[13px] text-brand">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {pending ? "Sending…" : "Check what's available at my address"}
          </button>
        </form>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `app/(app)/connectivity/page.tsx`, add the import beside the existing component imports:

```tsx
import { ConnectivityEnquiry } from "@/components/ConnectivityEnquiry";
```

Load the signed-in person's display name for the contact default — insert directly after the `const lines = await getConnectivityLines(...)` line:

```tsx
  const supabase = await createClient();
  const { data: person } = me.profile.person_id
    ? await supabase.from("people").select("display_name").eq("id", me.profile.person_id).maybeSingle()
    : { data: null };
```

and add `import { createClient } from "@/lib/supabase/server";` to the imports.

Then replace the empty-state branch:

```tsx
      {lines.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No connectivity services on your account yet.</p>
        </Card>
      ) : (
```

with:

```tsx
      {lines.length === 0 ? (
        <ConnectivityEnquiry
          contactName={person?.display_name ?? ""}
          contactEmail={me.profile.email}
        />
      ) : (
```

`Card` is still used by nothing else in this file, so remove it from the `@/components/ui` import, leaving `import { PageHeader } from "@/components/ui";`.

- [ ] **Step 3: Typecheck and build**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npx tsc --noEmit && npm run build
```

Expected: both clean. An "unused import Card" style lint error means Step 2's last instruction was skipped.

- [ ] **Step 4: Commit**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git add components/ConnectivityEnquiry.tsx "app/(app)/connectivity/page.tsx" && git commit -m "feat(connectivity): enquiry form replaces the empty-state dead end"
```

---

### Task 5: One-off reveal script

**Files:**
- Create: `scripts/reveal-connectivity.mjs`

**Interfaces:**
- Consumes: `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` from `.env.local`.
- Produces: a CLI. Default is a dry run that prints the affected users; `--apply` writes.

Clearing `connectivity` must leave every other override intact, and write `null` when nothing else remains — a leftover `{}` would be meaningless noise in the column. This is one-off by design; it is not an admin feature.

- [ ] **Step 1: Write the script**

Create `scripts/reveal-connectivity.mjs`:

```js
#!/usr/bin/env node
/**
 * One-off: give Connectivity back to client managers who have it explicitly
 * switched off in profiles.feature_overrides.
 *
 * Deliberately a script, not an admin page — this is expected to happen once
 * (the campaign of 2026-08-06). If a second bulk reveal comes up, that's the
 * moment to build the page.
 *
 *   node scripts/reveal-connectivity.mjs            # dry run — lists who
 *   node scripts/reveal-connectivity.mjs --apply    # writes
 *
 * Members are out of scope: the access model is subtractive, so clearing an
 * override cannot grant a member anything.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes("--apply");

const { data: rows, error } = await supabase
  .from("profiles")
  .select("id, email, client_id, role, feature_overrides")
  .eq("status", "active")
  .eq("role", "client_manager")
  .order("email");
if (error) throw new Error(error.message);

const { data: clients } = await supabase.from("clients").select("id, name");
const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));

const affected = (rows ?? []).filter(
  (r) => r.feature_overrides && typeof r.feature_overrides === "object" && r.feature_overrides.connectivity === false,
);

console.log(`${rows?.length ?? 0} active managers · ${affected.length} with Connectivity switched off\n`);
for (const r of affected) {
  const rest = { ...r.feature_overrides };
  delete rest.connectivity;
  const remaining = Object.keys(rest);
  console.log(
    `  ${(clientName.get(r.client_id) ?? "—").padEnd(28)} ${r.email.padEnd(38)} ` +
      `→ ${remaining.length ? `keeps off: ${remaining.join(", ")}` : "no overrides left"}`,
  );
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to clear 'connectivity' for these ${affected.length} users.`);
  process.exit(0);
}

let done = 0;
for (const r of affected) {
  const rest = { ...r.feature_overrides };
  delete rest.connectivity;
  const next = Object.keys(rest).length ? rest : null;
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ feature_overrides: next })
    .eq("id", r.id)
    .eq("role", "client_manager");
  if (upErr) {
    console.error(`  FAILED ${r.email}: ${upErr.message}`);
    continue;
  }
  done++;
}

const { count: still } = await supabase
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("status", "active")
  .eq("role", "client_manager")
  .eq("feature_overrides->>connectivity", "false");

console.log(`\nUpdated ${done}/${affected.length}. Managers still hiding Connectivity: ${still ?? "?"} (expect 0).`);
```

- [ ] **Step 2: Run the dry run**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && ~/.local/bin/node scripts/reveal-connectivity.mjs
```

Expected: a count near 66 and a per-user list. **Do not run `--apply` yet** — Task 6 shows this list to Shawn for approval first.

- [ ] **Step 3: Commit**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git add scripts/reveal-connectivity.mjs && git commit -m "chore(connectivity): one-off script to clear the connectivity override"
```

---

### Task 6: Live verification, approval gate, push

**Files:** none created. This task proves the feature against real data and gets the one destructive step approved.

- [ ] **Step 1: Full suite and build**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && npm test && npm run build
```

Expected: all green. Fix anything that fails before continuing.

- [ ] **Step 2: Live-test the enquiry against a throwaway client**

The dev server reads `.env.local`, so local dev talks to **production** Supabase. Use the existing throwaway: `shawn@jooste.co` at Jooste Co. Start the dev server, sign in as that user, open `/connectivity`, and submit the form with address `12 Long Street, Cape Town, 8001`.

Confirm, with the service role:

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && ~/.local/bin/node -e "
import('./scripts/_env.mjs').catch(()=>{});
" 2>/dev/null; ~/.local/bin/node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await s.from('rfqs').select('id, title, client_id, requested_by, status, description').ilike('title','Connectivity enquiry%');
console.log(JSON.stringify(data, null, 2));
"
```

Expected: exactly one row, `status = "new"`, `client_id` = Jooste Co's id, description containing the address.

- [ ] **Step 3: Confirm the rate limit and that lines still render**

Submit the same form a second time. Expected: the form refuses with *"We already have your enquiry — we'll come back to you shortly."* and the query above still returns exactly one row.

Then sign in as a user at a client that **has** active lines and open `/connectivity`. Expected: the line cards render exactly as before — no form, no change.

- [ ] **Step 4: Delete the test RFQ**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && ~/.local/bin/node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')];}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await s.from('rfqs').delete().ilike('title','Connectivity enquiry — Jooste Co').select('id');
console.log(error ? error.message : 'deleted ' + data.length);
"
```

Expected: `deleted 1`.

- [ ] **Step 5: Adversarial review**

The enquiry action writes with the service role to a staff-only table. Dispatch a reviewer whose job is to break it — specifically: can a client user write an RFQ for another client, get past the feature gate, exhaust the rate limit, or inject anything harmful into the RFQ description that a staff member later reads or that reaches Shawn's notification email? Fix whatever it finds before pushing.

- [ ] **Step 6: Push the code**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git push origin main
```

- [ ] **Step 7: Approval gate for the reveal — STOP HERE**

Show Shawn the dry-run list from Task 5 Step 2 (companies and email addresses, plus the count) and ask whether to run it. **Do not run `--apply` without an explicit yes.** On approval:

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && ~/.local/bin/node scripts/reveal-connectivity.mjs --apply
```

Expected: `Updated 66/66. Managers still hiding Connectivity: 0 (expect 0).`

- [ ] **Step 8: Preview the campaign audience**

After the reveal, the targeting helper should show the campaign's real reach. The campaign email copy itself is drafted and approved separately at send time — this step only counts the audience.

Run in the dev server (or a script using the RLS client as staff) and report to Shawn:

- `getPortalUpdateRecipients({ feature: "connectivity" })` → the whole audience
- `getPortalUpdateRecipients({ feature: "connectivity", hasService: "connectivity" })` → the "you already have this" cut

Expected: the first is near 171 minus opt-outs; the second is the handful at the 4 clients with active lines.

---

## Self-review

**Spec coverage.** §1 feature-aware targeting → Task 1 (including `excluded` with reasons and the `hasService` cut). §2 connectivity enquiry → Tasks 2–4: pitch and form (Task 4), RFQ fields and text (Task 2), service-client action with forced `client_id` and the one-open-enquiry rate limit (Task 3), confirmation state rather than a cleared form (Task 4), clients with lines unchanged (Task 4 Step 2 and Task 6 Step 3). §3 reveal → Task 5, with the approval gate at Task 6 Step 7 and the before/after count printed by the script. Testing section → vitest in Tasks 1–2, live checks in Task 6, build + suite at Task 6 Step 1. Out-of-scope items (prices, admin bulk page, additive access for members, auto-quoting, campaign copy) appear nowhere in the tasks.

**Types.** `Recipient` / `ExcludedRecipient` / `PartitionRow` are defined in Task 1 and re-exported from `portal-updates.ts` for consumers. `EnquiryInput` / `EnquiryPayload` / `buildEnquiry` are defined in Task 2 and used with matching keys in Task 3 (after its Step 2 fix). `EnquiryResult` and `submitConnectivityEnquiry` are defined in Task 3 and consumed with the same names in Task 4.
