// The quote service: the one place that creates a quote, so a team member or
// an AI agent can DRAFT a quote but never EMAIL one to a customer. `create`
// here never sends to a client and never produces status 'sent' — only a
// later send()/amend() may do that. Marker-free and alias-free so a plain
// Node script can import it directly — the Supabase client is passed in,
// never constructed here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor, QuoteStatus } from "./policy.ts";
import { decideCreateStatus, decideAmendStatus, canSendFrom, canRetryDelivery } from "./policy.ts";
import { computeTotals, fmtMoney, type QuoteDoc } from "./doc.ts";
import { deliverEmail } from "../email/deliver.ts";
import { ensureQuoteBookingLink } from "./booking-link.ts";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

// Quote mail's own FROM: quotes@ is the inbound-reply address, so a manager's
// "reply" to a quote threads back here. Changing it breaks that threading.
const QUOTE_FROM = '"Rocky @ Rocking" <quotes@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
// Standing rule: accounts@ is CC'd on all quote-related email.
const ACCOUNTS_EMAIL = "accounts@rocking.one";

export type CreateQuoteInput = {
  clientId: string;
  title: string;
  doc: QuoteDoc;
  validUntil?: string | null;
  internal?: { path: string; supplierCost: number | null; note?: string | null }[];
  checkoutEnabled?: boolean;
  billingStartsNextMonth?: boolean;
  idempotencyKey?: string | null;
};

// A fresh create() only ever produces draft/pending_review (replayed: false).
// A REPLAYED result reports the row's true current status, which can have
// moved on since (e.g. sent, accepted) — narrowing that to draft/pending_review
// would let a caller branching on status act on a quote that's already gone
// out, which is exactly the double-send this layer exists to prevent.
export type CreateResult =
  | { ok: true; replayed: false; status: "draft" | "pending_review"; quoteId: string; quoteNumber: string; version: number }
  | { ok: true; replayed: true; status: QuoteStatus; quoteId: string; quoteNumber: string; version: number }
  | { ok: false; error: string };

export type AmendQuoteInput = Pick<CreateQuoteInput, "title" | "doc" | "validUntil" | "internal">;

export type SendResult = { ok: true; sentTo: string[] } | { ok: false; error: string };

export type AmendResult =
  | { ok: true; version: number; status: "draft" | "pending_review" }
  | { ok: false; error: string };

// Untyped generic: the caller's client is typed against the app's Database
// schema (import "@/lib/types/database" is a Next.js path alias this module
// cannot use), so we accept the base client shape here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A quote with no priced line is not a quote yet — usage-based-only lines
 *  (null qty/unitPrice) don't count, same rule computeTotals uses. */
function hasPricedLine(doc: QuoteDoc): boolean {
  return (doc.sections ?? []).some((s) =>
    (s.groups ?? []).some((g) => (g.items ?? []).some((it) => it.qty != null && it.unitPrice != null)),
  );
}

function reviewEmailHtml(title: string, clientName: string, quoteId: string, totals: ReturnType<typeof computeTotals>): string {
  const reviewUrl = `${APP_URL}/admin/quotes/${quoteId}`;
  return `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
          <h2 style="margin:0 0 8px;">Quote ready for review</h2>
          <p style="color:#444; margin:0 0 16px;">
            A quote has been drafted and is ready to go out, but it hasn't been sent yet:
            <strong>${title}</strong> for <strong>${clientName}</strong> — ${fmtMoney(totals.grand)} incl VAT${totals.monthly != null ? ` + ${fmtMoney(totals.monthly)} / month` : ""}.
            Take a look and approve it to send.
          </p>
          <p style="margin:20px 0 0;">
            <a href="${reviewUrl}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">Review the quote</a>
          </p>
        </div>`;
}

function sentEmailSubject(quoteNumber: string, title: string, isRevision: boolean): string {
  const heading = isRevision
    ? `Updated quote from Rocking — ${quoteNumber}`
    : `New quote from Rocking — ${quoteNumber}`;
  return `${heading}: ${title}`;
}

/** The client-facing "here is your quote" email — equivalent to
 *  lib/quote-emails.ts's notifyQuoteSent, reproduced here (not imported)
 *  because that module uses "@/…" aliases this marker-free file cannot use. */
function sentEmailHtml(
  quoteId: string,
  title: string,
  quoteNumber: string,
  grandTotal: number | null,
  monthlyTotal: number | null,
  bookingUrl: string | null,
  isRevision: boolean,
): string {
  const heading = isRevision
    ? `Updated quote from Rocking — ${quoteNumber}`
    : `New quote from Rocking — ${quoteNumber}`;
  const viewUrl = `${APP_URL}/quotes/${quoteId}`;
  const bookingCta = bookingUrl
    ? `<p style="margin:18px 0 0; color:#444;">
         Prefer to talk it through? <a href="${bookingUrl}" style="color:#D7141C; font-weight:600;">Book a 30-minute call</a>
         &mdash; one booking per quote.
       </p>`
    : "";
  return `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
          <h2 style="margin:0 0 8px;">${heading}</h2>
          <p style="color:#444; margin:0 0 16px;">
            ${isRevision ? "We've revised a quote for you" : "We've prepared a quote for you"}:
            <strong>${title}</strong> — ${fmtMoney(grandTotal)} incl VAT${monthlyTotal != null ? ` + ${fmtMoney(monthlyTotal)} / month` : ""}.
            You can review it, print it, and accept or decline online.
          </p>
          <p style="margin:20px 0 0;">
            <a href="${viewUrl}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">View the quote</a>
          </p>
          ${bookingCta}
          <p style="margin:24px 0 0; color:#888; font-size:12.5px;">— Rocky</p>
        </div>`;
}

/** Deletes everything create() may have written, child-before-parent, so a
 *  failure partway through never leaves an orphan quote with no version.
 *  Safe to call even when some of these rows were never created — a delete
 *  that matches nothing is a no-op. Every step is individually guarded: a
 *  transient failure on one delete must not abort the rest, or the orphan
 *  this function exists to prevent is exactly what a half-run cleanup leaves
 *  behind. compensate() itself therefore never throws. */
async function compensate(sb: Sb, quoteId: string): Promise<void> {
  let versionIds: string[] = [];
  try {
    const { data: versions } = await sb.from("quote_versions").select("id").eq("quote_id", quoteId);
    versionIds = ((versions ?? []) as { id: string }[]).map((v) => v.id);
  } catch (e) {
    console.error("compensate: failed to look up quote_versions:", e);
  }

  if (versionIds.length) {
    try {
      await sb.from("quote_internal").delete().in("version_id", versionIds);
    } catch (e) {
      console.error("compensate: failed to delete quote_internal:", e);
    }
  }
  try {
    await sb.from("quote_events").delete().eq("quote_id", quoteId);
  } catch (e) {
    console.error("compensate: failed to delete quote_events:", e);
  }
  try {
    await sb.from("quote_versions").delete().eq("quote_id", quoteId);
  } catch (e) {
    console.error("compensate: failed to delete quote_versions:", e);
  }
  try {
    await sb.from("quotes").delete().eq("id", quoteId);
  } catch (e) {
    console.error("compensate: failed to delete quotes:", e);
  }
}

export function makeQuoteService(sb: Sb) {
  async function create(input: CreateQuoteInput, actor: Actor): Promise<CreateResult> {
    // 1. Idempotent replay: a repeated key returns the original quote and
    // writes nothing new.
    if (input.idempotencyKey) {
      const { data: existing } = await sb
        .from("quotes")
        .select("id, quote_number, current_version, status")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return {
          ok: true,
          replayed: true,
          status: existing.status as QuoteStatus,
          quoteId: existing.id,
          quoteNumber: existing.quote_number,
          version: existing.current_version,
        };
      }
    }

    // 2. Validate: client exists (its quote_prefix is also fetched here for
    // step 3, so there's one client lookup, not two).
    const { data: client } = await sb
      .from("clients")
      .select("id, name, quote_prefix")
      .eq("id", input.clientId)
      .maybeSingle();
    if (!client) return { ok: false, error: "client not found" };

    if (!hasPricedLine(input.doc)) {
      return { ok: false, error: "quote has no priced line items" };
    }

    if (input.validUntil) {
      const parsed = new Date(input.validUntil);
      if (isNaN(parsed.getTime())) return { ok: false, error: "validUntil is not a valid date" };
      if (input.validUntil < todayIso()) return { ok: false, error: "validUntil is in the past" };
    }

    // 3. Resolve the client's numbering prefix. A null prefix is a deliberate
    // refusal, never a guess.
    const prefix = client.quote_prefix as string | null;
    if (!prefix) return { ok: false, error: "client has no quote prefix set" };

    const { data: quoteNumber, error: numErr } = await sb.rpc("next_quote_number", { p_prefix: prefix });
    if (numErr || !quoteNumber) {
      return { ok: false, error: numErr?.message ?? "could not allocate a quote number" };
    }

    // 4. Totals + stamp the freshly-minted number into the document.
    const totals = computeTotals(input.doc);
    const doc: QuoteDoc = { ...input.doc, meta: { ...input.doc.meta, quoteNumber } };
    const status = decideCreateStatus(actor);

    // 5. Insert quotes.
    const { data: quoteRow, error: qErr } = await sb
      .from("quotes")
      .insert({
        client_id: input.clientId,
        quote_number: quoteNumber,
        title: input.title,
        status,
        checkout_enabled: input.checkoutEnabled ?? false,
        billing_starts_next_month: input.billingStartsNextMonth ?? false,
        idempotency_key: input.idempotencyKey ?? null,
      })
      .select("id")
      .single();
    if (qErr || !quoteRow) return { ok: false, error: qErr?.message ?? "failed to create quote" };
    const quoteId = quoteRow.id as string;

    // Everything from here on undoes cleanly on failure — see compensate().
    try {
      // 6. Insert quote_versions.
      const { data: versionRow, error: vErr } = await sb
        .from("quote_versions")
        .insert({
          quote_id: quoteId,
          version: 1,
          doc,
          subtotal: totals.subtotal,
          vat_amount: totals.vat,
          grand_total: totals.grand,
          monthly_total: totals.monthly,
          valid_until: input.validUntil ?? null,
        })
        .select("id")
        .single();
      if (vErr || !versionRow) throw new Error(vErr?.message ?? "failed to create quote version");
      const versionId = versionRow.id as string;

      // 7. Insert quote_internal (supplier costs), when there are any.
      if (input.internal?.length) {
        const rows = input.internal.map((r) => ({
          version_id: versionId,
          line_path: r.path,
          supplier_cost: r.supplierCost ?? null,
          note: r.note ?? null,
        }));
        const { error: iErr } = await sb.from("quote_internal").insert(rows);
        if (iErr) throw new Error(iErr.message);
      }

      // 8. Insert quote_events: 'created' always; the status event too, but
      // only for pending_review — quote_events.event's CHECK constraint
      // (migration 0059) does not include 'draft', and a draft event would
      // carry no information the 'created' event doesn't already (this
      // matches how existing draft quotes look in the database today).
      const events: { quote_id: string; version: number; event: string; actor_profile_id: string | null }[] = [
        { quote_id: quoteId, version: 1, event: "created", actor_profile_id: actor.id },
      ];
      if (status === "pending_review") {
        events.push({ quote_id: quoteId, version: 1, event: "pending_review", actor_profile_id: actor.id });
      }
      const { error: eErr } = await sb.from("quote_events").insert(events);
      if (eErr) throw new Error(eErr.message);

      // 9. The only email create() ever sends: a staff review notification —
      // never the client. A failed notification must not undo an
      // already-safe pending-review quote, so it's caught, not thrown.
      if (status === "pending_review") {
        try {
          await deliverEmail(sb, {
            from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
            to: ["shawn@rocking.one", "kelle@rocking.one"],
            cc: ["accounts@rocking.one"],
            subject: `Quote ${quoteNumber} ready for review — ${doc.client.name}`,
            html: reviewEmailHtml(input.title, doc.client.name, quoteId, totals),
            category: "quote",
            audience: "internal",
          });
        } catch (e) {
          console.error("quote review notification failed:", e);
        }
      }

      return { ok: true, quoteId, quoteNumber, version: 1, status, replayed: false };
    } catch (e) {
      await compensate(sb, quoteId);
      return { ok: false, error: e instanceof Error ? e.message : "failed to create quote" };
    }
  }

  /** Emails a quote to the client. The one place `quotes.status` may become
   *  'sent' — everything upstream (create/amend) refuses to. */
  async function send(quoteId: string, actor: Actor): Promise<SendResult> {
    // Priority 1, unmistakably first: refuse a caller who may not send,
    // before any query touches the database.
    if (!actor.canSend) return { ok: false, error: "this caller may not send quotes" };

    // 1. Load the quote.
    const { data: quote } = await sb
      .from("quotes")
      .select("id, client_id, quote_number, title, current_version, status")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) return { ok: false, error: "quote not found" };

    const currentStatus = quote.status as QuoteStatus;
    const currentVersion = quote.current_version as number;

    // 2. Load the current version's 'sent' event resend_message_id, so a
    // send that reads 'sent' but never confirmed delivery (Resend never
    // called back) can be told apart from an already-delivered quote.
    const { data: sentEvent } = await sb
      .from("quote_events")
      .select("resend_message_id")
      .eq("quote_id", quoteId)
      .eq("version", currentVersion)
      .eq("event", "sent")
      .maybeSingle();
    const messageId = (sentEvent?.resend_message_id as string | null | undefined) ?? null;

    const isRetry = canRetryDelivery(currentStatus, messageId);
    if (!canSendFrom(currentStatus) && !isRetry) {
      return { ok: false, error: `cannot send a quote in status "${currentStatus}"` };
    }

    if (!isRetry) {
      // 3. First send: flip the status atomically (only if it's still the
      // status we just read) and record the event. A retry skips both — the
      // quote is already 'sent' and the event already exists.
      const { data: updated } = await sb
        .from("quotes")
        .update({ status: "sent" })
        .eq("id", quoteId)
        .eq("status", currentStatus)
        .select("id")
        .maybeSingle();
      if (!updated) return { ok: false, error: "this quote was just sent elsewhere" };

      const { error: evErr } = await sb.from("quote_events").insert({
        quote_id: quoteId,
        version: currentVersion,
        event: "sent",
        actor_profile_id: actor.id,
      });
      if (evErr) return { ok: false, error: evErr.message };
    }

    // 4. Booking link + recipients. Never throws — a quote must still go
    // out if Calendly is down.
    const bookingUrl = await ensureQuoteBookingLink(sb, quoteId);

    const { data: managers } = await sb
      .from("profiles")
      .select("email")
      .eq("client_id", quote.client_id)
      .eq("role", "client_manager")
      .eq("status", "active");
    const to = ((managers ?? []) as { email: string }[]).map((m) => m.email);
    if (to.length === 0) return { ok: false, error: "client has no active managers" };

    const { data: versionRow } = await sb
      .from("quote_versions")
      .select("grand_total, monthly_total")
      .eq("quote_id", quoteId)
      .eq("version", currentVersion)
      .maybeSingle();
    const grandTotal = (versionRow?.grand_total as number | null | undefined) ?? null;
    const monthlyTotal = (versionRow?.monthly_total as number | null | undefined) ?? null;
    // A quote only ever reaches version > 1 via amend(), so this is a fair
    // stand-in for "the client has seen a version of this quote before".
    const isRevision = currentVersion > 1;

    let delivered: { id: string | null; suppressed: string[] };
    try {
      delivered = await deliverEmail(sb, {
        from: QUOTE_FROM,
        to,
        cc: [ADMIN_EMAIL, ACCOUNTS_EMAIL],
        subject: sentEmailSubject(quote.quote_number, quote.title, isRevision),
        html: sentEmailHtml(quoteId, quote.title, quote.quote_number, grandTotal, monthlyTotal, bookingUrl, isRevision),
        category: "quote",
        audience: "client",
        clientId: quote.client_id,
      });
    } catch (e) {
      // deliverEmail THROWS on a Resend rejection. The quote is already
      // 'sent' with no resend_message_id — exactly the state canRetryDelivery
      // watches for, so a later retry picks this up rather than the mail
      // being lost silently or the quote being stuck unsendable.
      return { ok: false, error: e instanceof Error ? e.message : "failed to send quote email" };
    }

    // 5. This is what makes the retry check work — without recording it, a
    // successful send looks like a failed one forever.
    const formattedMessageId = delivered.id ? `<${delivered.id}@send.rocking.one>` : null;
    try {
      const { error } = await sb
        .from("quote_events")
        .update({ resend_message_id: formattedMessageId })
        .eq("quote_id", quoteId)
        .eq("version", currentVersion)
        .eq("event", "sent");
      if (error) console.error("send: failed to record resend_message_id:", error.message);
    } catch (e) {
      console.error("send: failed to record resend_message_id:", e);
    }

    const suppressedLower = new Set(delivered.suppressed.map((e) => e.trim().toLowerCase()));
    const sentTo = to.filter((e) => !suppressedLower.has(e.trim().toLowerCase()));
    return { ok: true, sentTo };
  }

  /** Amends a quote: a new version, and a status that is NEVER 'sent' — for
   *  every actor, including one who can send. A revision must never be
   *  visible to the client before someone explicitly sends it; that's the
   *  back door this whole design exists to close. */
  async function amend(quoteId: string, input: AmendQuoteInput, actor: Actor): Promise<AmendResult> {
    // 1. Load the quote.
    const { data: quote } = await sb
      .from("quotes")
      .select("id, current_version, status")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) return { ok: false, error: "quote not found" };

    const currentStatus = quote.status as QuoteStatus;
    if (currentStatus === "accepted") return { ok: false, error: "cannot amend an accepted quote" };

    const currentVersion = quote.current_version as number;
    const newVersion = currentVersion + 1;
    const totals = computeTotals(input.doc);
    const newStatus = decideAmendStatus(actor); // draft | pending_review — never 'sent'

    // 2. Insert the new quote_versions row.
    const { data: versionRow, error: vErr } = await sb
      .from("quote_versions")
      .insert({
        quote_id: quoteId,
        version: newVersion,
        doc: input.doc,
        subtotal: totals.subtotal,
        vat_amount: totals.vat,
        grand_total: totals.grand,
        monthly_total: totals.monthly,
        valid_until: input.validUntil ?? null,
      })
      .select("id")
      .single();
    if (vErr || !versionRow) return { ok: false, error: vErr?.message ?? "failed to create quote version" };
    const versionId = versionRow.id as string;

    // 3. quote_internal (supplier costs), when there are any.
    if (input.internal?.length) {
      const rows = input.internal.map((r) => ({
        version_id: versionId,
        line_path: r.path,
        supplier_cost: r.supplierCost ?? null,
        note: r.note ?? null,
      }));
      const { error: iErr } = await sb.from("quote_internal").insert(rows);
      if (iErr) return { ok: false, error: iErr.message };
    }

    // 4. Point the quote at the new version and its (never-'sent') status.
    const { error: qErr } = await sb
      .from("quotes")
      .update({ current_version: newVersion, title: input.title, status: newStatus })
      .eq("id", quoteId);
    if (qErr) return { ok: false, error: qErr.message };

    // 5. Record the review request — but only for pending_review.
    // quote_events.event's CHECK constraint (migration 0059) does not include
    // 'draft'; a 'draft' event would throw. For a draft amend, the new
    // quote_versions row is itself the record.
    if (newStatus === "pending_review") {
      const { error: eErr } = await sb.from("quote_events").insert({
        quote_id: quoteId,
        version: newVersion,
        event: "pending_review",
        actor_profile_id: actor.id,
      });
      if (eErr) return { ok: false, error: eErr.message };
    }

    return { ok: true, version: newVersion, status: newStatus };
  }

  return { create, send, amend };
}
