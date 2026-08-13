// The quote service: the one place that creates a quote, so a team member or
// an AI agent can DRAFT a quote but never EMAIL one to a customer. `create`
// here never sends to a client and never produces status 'sent' — only a
// later send()/amend() may do that. Marker-free and alias-free so a plain
// Node script can import it directly — the Supabase client is passed in,
// never constructed here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./policy.ts";
import { decideCreateStatus } from "./policy.ts";
import { computeTotals, fmtMoney, type QuoteDoc } from "./doc.ts";
import { deliverEmail } from "../email/deliver.ts";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

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

export type CreateResult =
  | { ok: true; quoteId: string; quoteNumber: string; version: number; status: "draft" | "pending_review"; replayed: boolean }
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

/** Deletes everything create() may have written, child-before-parent, so a
 *  failure partway through never leaves an orphan quote with no version.
 *  Safe to call even when some of these rows were never created — a delete
 *  that matches nothing is a no-op. */
async function compensate(sb: Sb, quoteId: string): Promise<void> {
  const { data: versions } = await sb.from("quote_versions").select("id").eq("quote_id", quoteId);
  const versionIds = ((versions ?? []) as { id: string }[]).map((v) => v.id);
  if (versionIds.length) {
    await sb.from("quote_internal").delete().in("version_id", versionIds);
  }
  await sb.from("quote_events").delete().eq("quote_id", quoteId);
  await sb.from("quote_versions").delete().eq("quote_id", quoteId);
  await sb.from("quotes").delete().eq("id", quoteId);
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
          quoteId: existing.id,
          quoteNumber: existing.quote_number,
          version: existing.current_version,
          // The type only names draft/pending_review because that's all
          // create() itself ever produces; a replay hitting a quote that has
          // since moved on (e.g. sent) still reports its true stored status
          // rather than mislabeling it as one of the two.
          status: existing.status as "draft" | "pending_review",
          replayed: true,
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

      // 8. Insert quote_events: created, then the status event.
      const { error: eErr } = await sb.from("quote_events").insert([
        { quote_id: quoteId, version: 1, event: "created", actor_profile_id: actor.id },
        { quote_id: quoteId, version: 1, event: status, actor_profile_id: actor.id },
      ]);
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

  return { create };
}
