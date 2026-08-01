# Ticket-Anchored Sessions (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every paid session belongs to a ticket — created in the same flow or an existing one — and payment notes that ticket instead of spawning a duplicate.

**Architecture:** `support_bookings.ticket_number` anchors a booking to a FreeScout conversation, set at creation and validated against the caller's support scope. `/support/new` grows a "how would you like this handled?" step (free reply, or a session with the existing picker); the ticket detail page gains the same session action. `confirmBooking` posts an internal note to the anchored ticket and reopens it if closed, falling back to today's create-a-ticket path for pre-existing bookings. The standalone booking card is removed.

**Tech Stack:** Next.js 16 (server actions), Supabase, FreeScout REST (proxied through the Cloudflare tunnel), Paystack, vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-ticket-anchored-sessions-design.md`

**Verified live before planning** (against the tunnel, throwaway ticket, cleaned up): `POST /conversations/{id}/threads` with `{type:"note", user:1}` → **201**; `PUT /conversations/{id}` with `{status, byUser:1}` → **204**; reopening a closed ticket returns it to `active`.

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; check `ls supabase/migrations | tail -1` for the next free number (0070/0071 are taken — another session is also committing here).
- All commands from `/Users/shawnjooste/Documents/Claude/dashboard-v2`; quote parenthesized paths.
- FreeScout is the ticket store — proxy it, never mirror it. The portal owns bookings/time only.
- Slice A charges **every** tier via Paystack; covered bookings are Slice C. Do not add tier logic here.
- Side-effects stay best-effort: a payment must never be lost because FreeScout is unreachable.
- A client must never anchor a booking to another client's ticket — validate server-side with the existing `getSupportScope()` + `canAccessConversation()`.
- Design tokens as elsewhere (`Card`, `CardHeader`, `PageHeader`, `FIELD` input style).
- Clear `.next` "* N.*" duplicate junk before `tsc` if the known Finder-copy issue reappears.

---

### Task 1: FreeScout note + reopen, and the note wording (TDD on the pure part)

**Files:**
- Modify: `lib/freescout.ts`
- Create: `lib/booking-note.ts`
- Test: `lib/booking-note.test.ts`

**Interfaces:**
- Produces: `addTicketNote(conversationId: number, text: string): Promise<void>`; `reopenTicket(conversationId: number): Promise<void>`; `bookingNoteText(o: { serviceName: string; slotLabel: string; totalCents: number; reference: string; note?: string | null }): string`; `bookingCancelledNoteText(o: { serviceName: string; slotLabel: string }): string`.

- [ ] **Step 1: Write the failing test**

`lib/booking-note.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bookingCancelledNoteText, bookingNoteText } from "./booking-note";

describe("bookingNoteText", () => {
  const base = {
    serviceName: "Remote support session",
    slotLabel: "Mon 3 Aug, 12:30",
    totalCents: 57500,
    reference: "bk_abc",
    note: "Outlook keeps crashing",
  };
  it("states service, slot and amount", () => {
    const t = bookingNoteText(base);
    expect(t).toContain("Remote support session");
    expect(t).toContain("Mon 3 Aug, 12:30");
    expect(t).toContain("R 575,00");
    expect(t).toContain("bk_abc");
  });
  it("includes the client's note when given", () => {
    expect(bookingNoteText(base)).toContain("Outlook keeps crashing");
  });
  it("omits the note line when absent", () => {
    expect(bookingNoteText({ ...base, note: null })).not.toContain("Client's note");
  });
});

describe("bookingCancelledNoteText", () => {
  it("names the service and slot", () => {
    const t = bookingCancelledNoteText({ serviceName: "Onsite callout", slotLabel: "Tue 4 Aug, 09:00" });
    expect(t).toContain("cancelled");
    expect(t).toContain("Onsite callout");
    expect(t).toContain("Tue 4 Aug, 09:00");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/booking-note.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement the wording**

`lib/booking-note.ts`:

```ts
import { fmtRands } from "@/lib/booking-helpers";

/** Internal note posted on the anchored ticket when a session is paid. */
export function bookingNoteText(o: {
  serviceName: string;
  slotLabel: string;
  totalCents: number;
  reference: string;
  note?: string | null;
}): string {
  const lines = [
    `Paid ${o.serviceName} booked for ${o.slotLabel}.`,
    `Amount: ${fmtRands(o.totalCents)} incl VAT · ref ${o.reference}`,
  ];
  if (o.note) lines.push("", `Client's note: ${o.note}`);
  return lines.join("\n");
}

/** Internal note posted when a booking is cancelled. */
export function bookingCancelledNoteText(o: { serviceName: string; slotLabel: string }): string {
  return `The ${o.serviceName} booked for ${o.slotLabel} was cancelled. Any refund is handled manually in Paystack.`;
}
```

- [ ] **Step 4: Add the two FreeScout calls**

In `lib/freescout.ts`, after `replyToTicket`:

```ts
/** Internal (staff-only) note on a conversation — used to record paid
 *  sessions against the ticket they belong to. Verified: 201. */
export async function addTicketNote(conversationId: number, text: string): Promise<void> {
  const res = await fsFetch(`/conversations/${conversationId}/threads`, {
    method: "POST",
    body: JSON.stringify({ type: "note", text, user: 1 }),
  });
  if (!res.ok) throw new Error(`FreeScout note failed (${res.status})`);
}

/** Reopen a closed conversation — a paid session means it's live work again. */
export async function reopenTicket(conversationId: number): Promise<void> {
  const res = await fsFetch(`/conversations/${conversationId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "active", byUser: 1 }),
  });
  if (!res.ok) throw new Error(`FreeScout reopen failed (${res.status})`);
}
```

- [ ] **Step 5: Verify + commit** — `npx vitest run lib/booking-note.test.ts` (5 pass), `npx tsc --noEmit`, `npm test`.

```bash
git add lib/booking-note.ts lib/booking-note.test.ts lib/freescout.ts
git commit -m "feat(support): ticket notes + reopen, and paid-session note wording"
```

---

### Task 2: Migration — anchor column

**Files:**
- Create: `supabase/migrations/<next>_booking_ticket_anchor.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write it** (check `ls supabase/migrations | tail -1` first and use the next free number)

```sql
-- The ticket a session belongs to. Set when the booking is created, so the
-- confirmation notes that conversation instead of creating a duplicate.
-- freescout_number keeps its meaning (the ticket we posted to); for new
-- bookings the two match, and older rows keep working via the fallback path.
alter table public.support_bookings
  add column ticket_number int;
```

- [ ] **Step 2: Push** — `cat supabase/.temp/project-ref` (must be `eskhokedsximnslgsycs`), then `npx supabase db push --linked`.

- [ ] **Step 3: Types** — `npx supabase gen types typescript --linked > /tmp/db.new.ts && grep -c ticket_number /tmp/db.new.ts && mv /tmp/db.new.ts lib/types/database.ts` (write via temp file — a hung generate has truncated this file before), then `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations lib/types/database.ts
git commit -m "feat(support): ticket_number anchor on bookings"
```

---

### Task 3: Actions — anchored creation, notes on confirm/cancel

**Files:**
- Modify: `lib/actions/bookings.ts`
- Modify: `lib/booking-confirm.ts`
- Modify: `app/(app)/support/actions.ts`

**Interfaces:**
- `createBooking` reads an optional `ticket_number` form field; validates visibility; stores it.
- New `createTicketAndBook(_prev, formData)` in `app/(app)/support/actions.ts`: creates the ticket, then either redirects to it (free path) or creates the anchored booking and returns the Paystack URL.
- `confirmBooking` / `cancelBooking` note the anchored ticket.

- [ ] **Step 1: Anchor validation in `createBooking`**

In `lib/actions/bookings.ts`, after the existing slot/service validation and before insert:

```ts
  // Anchor (optional in slice A's data model, always present from the UI):
  // a client must not attach a session to someone else's ticket.
  const ticketRaw = String(formData.get("ticket_number") ?? "").trim();
  let ticketNumber: number | null = null;
  if (ticketRaw) {
    const n = Number(ticketRaw);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "That ticket doesn't look right." };
    const scope = await getSupportScope();
    const ticket = scope ? await getConversation(n) : null;
    if (!scope || !ticket || !canAccessConversation(ticket.customerEmail, scope.email, scope.clientDomains)) {
      return { ok: false, error: "That ticket isn't yours to book against." };
    }
    ticketNumber = n;
  }
```

with imports `import { getSupportScope, getConversation } from "@/lib/freescout";` and
`import { canAccessConversation } from "@/lib/freescout-scope";`, and `ticket_number: ticketNumber` added to the insert payload.

- [ ] **Step 2: Note the anchored ticket on confirm**

In `lib/booking-confirm.ts`: add `ticket_number` to the booking select, import
`addTicketNote, reopenTicket` from `@/lib/freescout` and `bookingNoteText` from
`@/lib/booking-note`, then replace the ticket-creation block inside the
best-effort `try` with:

```ts
      if (b.ticket_number) {
        // Anchored: record the session on the client's existing ticket.
        await reopenTicket(b.ticket_number);
        await addTicketNote(
          b.ticket_number,
          bookingNoteText({
            serviceName: svc?.name ?? "Support session",
            slotLabel: label,
            totalCents: due,
            reference,
            note: b.note,
          }),
        );
        await service.from("support_bookings").update({ freescout_number: b.ticket_number }).eq("id", b.id);
      } else {
        const ticketId = await createTicket({
          email,
          subject: `Paid ${svc?.name ?? "support session"}: ${label} — ${clientName}`,
          message: `Paid booking confirmed (ref ${reference}).\n\nService: ${svc?.name}\nSlot: ${label}\nClient: ${clientName}\n\nClient's note:\n${b.note ?? "—"}`,
          tags: ["booking", `tier:${tierKey}`],
        });
        await service.from("support_bookings").update({ freescout_number: ticketId }).eq("id", b.id);
      }
```

(The confirmation email to the client stays exactly as-is in both paths.)

- [ ] **Step 3: Note on cancel**

In `lib/actions/bookings.ts`'s `cancelBooking`, extend the existing lookup to
`select("calendly_event_uri, ticket_number, slot_start, support_services(name)")`
and after the Calendly cancellation add:

```ts
  if (b?.ticket_number) {
    try {
      await addTicketNote(
        b.ticket_number,
        bookingCancelledNoteText({
          serviceName: (b.support_services as unknown as { name: string } | null)?.name ?? "session",
          slotLabel: slotLabel(b.slot_start),
        }),
      );
    } catch (e) {
      console.error("cancel note failed:", e);
    }
  }
```

with imports for `addTicketNote`, `bookingCancelledNoteText` and `slotLabel`
(from `@/lib/calendly-helpers`).

- [ ] **Step 4: The combined create-ticket-then-book action**

In `app/(app)/support/actions.ts`:

```ts
export type GetHelpResult = { error?: string };

/** "Get help": always create the ticket first — an abandoned payment must
 *  never lose the client's problem description. Then, if they asked for a
 *  session, anchor a booking to that ticket and hand off to Paystack. */
export async function createTicketAndBook(
  _prev: GetHelpResult | null,
  formData: FormData,
): Promise<GetHelpResult> {
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const mode = String(formData.get("mode") ?? "reply");
  if (!subject || !message) return { error: "Subject and message are both required." };

  const scope = await getSupportScope();
  if (!scope) redirect("/login");

  let tags: string[] | undefined;
  const me = await getCurrentProfile();
  if (me.authenticated && me.profile.client_id) {
    const status = await getSupportStatus(me.profile.client_id);
    if (status.pkg) tags = [`tier:${status.pkg.key}`];
  }

  let id: number;
  try {
    id = await createTicket({ email: scope.email, subject, message, tags });
  } catch {
    return { error: "Couldn't create the ticket right now. Please try again shortly." };
  }

  if (mode === "reply") redirect(`/support/${id}`);

  const bookingForm = new FormData();
  bookingForm.set("service_id", String(formData.get("service_id") ?? ""));
  bookingForm.set("slot_iso", String(formData.get("slot_iso") ?? ""));
  bookingForm.set("note", subject);
  bookingForm.set("ticket_number", String(id));
  const booked = await createBooking(null, bookingForm);
  if (!booked.ok) return { error: `${booked.error} Your ticket (#${id}) was logged — we'll pick it up.` };
  redirect(booked.url);
}
```

with `import { createBooking } from "@/lib/actions/bookings";` added.

- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit && npm test`.

```bash
git add lib/actions/bookings.ts lib/booking-confirm.ts "app/(app)/support/actions.ts"
git commit -m "feat(support): anchor bookings to tickets; note the ticket on confirm/cancel"
```

---

### Task 4: UI — one "Get help" flow, session from a ticket, card removed

**Files:**
- Modify: `app/(app)/support/new/page.tsx`
- Modify: `app/(app)/support/page.tsx`
- Modify: `app/(app)/support/[id]/page.tsx`
- Modify: `components/BookSession.tsx`

- [ ] **Step 1: Make the picker embeddable**

`BookSession` gains optional props so it can live inside another form rather
than owning one: `{ embedded?: boolean; ticketNumber?: number }`. When
`embedded` is true it renders the tiles + picker and its hidden
`service_id`/`slot_iso` inputs **without** a `<form>`, submit button or
action — the parent form owns those. When false it behaves exactly as today.
Add a `mode` radio pair above the picker in embedded mode
(`reply` / `session`), and only show the picker when `session` is chosen.

- [ ] **Step 2: `/support/new` becomes the Get-help flow**

Fetch `getActiveServices()` + `getOpenSlotsByService()` server-side, switch
the form action to `createTicketAndBook`, and render subject, message, then
`<BookSession embedded services={services} slotsByService={slots} />`. Submit
button copy: "Send" for reply mode, "Book & pay …" once a session is chosen —
the existing `BookSession` already computes that string.

- [ ] **Step 3: `/support` loses the standalone card**

Remove the `<Card>` wrapping `BookSession` and its intro paragraph. Keep the
bookings list and tickets list. The header action stays "+ Raise a ticket"
pointing at `/support/new` (now the combined flow).

- [ ] **Step 4: Session from an existing ticket**

On `app/(app)/support/[id]/page.tsx`, add a card below the reply box:
"Need hands-on help with this?" containing a form posting to `createBooking`
with `<input type="hidden" name="ticket_number" value={ticket.number} />` and
`<BookSession services={services} slotsByService={slots} />` (non-embedded —
it owns this form). Fetch services/slots on the page.

- [ ] **Step 5: Quiet link on open rows in the ticket list**

In `/support`'s ticket rows, when `t.status !== "closed"`, render a small
`Book support →` link to `/support/${t.id}#book`.

- [ ] **Step 6: Verify + commit** — `npm test && npm run build`.

```bash
git add "app/(app)/support" components/BookSession.tsx
git commit -m "feat(support): ticket-first Get help flow; sessions from a ticket"
```

---

### Task 5: Verify end-to-end + ship

- [ ] **Step 1:** `npm test && npm run build` — green.
- [ ] **Step 2: Anchored happy path (production, service-role harness).** Create a ticket via the API, insert a pending booking carrying its `ticket_number`, fire a signed Paystack webhook at production, then assert: booking `paid`, **no new conversation created**, an internal note on the original ticket, `freescout_number == ticket_number`, and the Calendly event created. Clean up (cancel Calendly event, delete note-bearing ticket, delete booking).
- [ ] **Step 3: Reopen behaviour.** Same as above but close the ticket first; assert it returns to `active`.
- [ ] **Step 4: Legacy path.** A booking with `ticket_number` null still creates a ticket as before (backwards compatibility for rows predating this slice).
- [ ] **Step 5: Ownership guard.** `createBooking` with another client's ticket number is rejected — exercise `canAccessConversation` directly with a foreign email/domain pair.
- [ ] **Step 6: Ship.** `git push origin main`, wait for READY, spot-check `/support` and `/support/new` return 307→login (healthy) in production.
