// Pure assembler: turns a caller's varying parts (client, title, items,
// prose) into a full QuoteDoc + CreateQuoteInput/AmendQuoteInput, with the
// template and markup rule owned entirely here so a caller of the quote API
// can never get them wrong. Pure module — no I/O, no Date.now() (today is
// injected via opts.today). Marker-free and alias-free: no `import
// "server-only"`, no `@/...` aliases, relative imports with the `.ts` suffix,
// so a plain Node script (or the API route) can import this directly.
import type { QuoteDoc, QuoteItem, QuoteSection } from "./doc.ts";
import type { CreateQuoteInput, AmendQuoteInput } from "./service.ts";
import {
  COMPANY,
  BANKING,
  STANDARD_TERMS,
  CHECKOUT_PAYMENT_TERM,
  EFT_PAYMENT_TERM,
  VALIDITY_DAYS,
} from "./api-template.ts";

export type ApiQuoteItem = {
  description: string;
  detail?: string;
  qty: number;
  supplierCostExVat?: number;
  unitPriceExVat?: number;
  monthly?: boolean;
};

export type ApiCreateBody = {
  client?: string;
  clientId?: string;
  title: string;
  items: ApiQuoteItem[];
  intro?: string | null;
  summaryNote?: string | null;
  extraTerms?: string[];
  attention?: string | null;
  validUntil?: string | null;
  checkout?: boolean;
  billingStartsNextMonth?: boolean;
};

export type ApiAmendBody = Omit<ApiCreateBody, "client" | "clientId" | "checkout" | "billingStartsNextMonth">;

export type ClientContext = {
  id: string;
  name: string;
  registeredName?: string | null;
  /** from client_company_details.billing_contact_name */
  attention?: string | null;
  /** from physical_address split on newlines */
  addressLines?: string[];
};

export type FieldError = { field: string; message: string };

type InternalRow = { path: string; supplierCost: number; note: string };

/** Backslash-escapes ILIKE wildcards (`%`, `_`) and the escape character
 *  itself (`\`) so a caller-supplied search string can never widen a
 *  Postgres ILIKE pattern beyond a literal substring match — an unescaped
 *  "%" would otherwise match every row. Shared by every route/script that
 *  builds an `ilike` pattern from user input. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Round to 2 decimal places, half-up (`Math.round`), the house convention for money. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** yyyy-mm-dd of a UTC-anchored date. */
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "13 August 2026" — display format used across every existing quote. */
function displayDate(d: Date): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return utc.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

function plusDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/** True yyyy-mm-dd validity — rejects non-calendar dates like 2026-02-30. */
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !isNaN(d.getTime()) && isoDate(d) === s;
}

type ValidatableBody = {
  title: string;
  items: ApiQuoteItem[];
  validUntil?: string | null;
  intro?: string | null;
  summaryNote?: string | null;
  extraTerms?: string[];
  attention?: string | null;
};

/** U+0000-U+001F, no exceptions (not even tab/newline) — a title is a
 *  single display line, never multi-line free text. */
const CONTROL_CHAR_RE = /[\u0000-\u001F]/;
const TITLE_MAX_LEN = 200;

/** True for a JSON value that could plausibly hold a validated field —
 *  i.e. not the values that would otherwise crash a `typeof value !==
 *  "string"` / `.property` access downstream. Kept trivial on purpose: the
 *  real gate is always the explicit type check that follows. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pushes a field error when `value` is present (not null/undefined) but
 *  not a string — used for every optional prose field. */
function checkOptionalString(errors: FieldError[], field: string, value: unknown): void {
  if (value != null && typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string when present.` });
  }
}

function validateBody(body: ValidatableBody, today: Date): FieldError[] {
  const errors: FieldError[] = [];

  if (typeof body.title !== "string" || !body.title.trim()) {
    errors.push({ field: "title", message: "Title is required and must be a string." });
  } else {
    if (CONTROL_CHAR_RE.test(body.title)) {
      errors.push({ field: "title", message: "Title cannot contain control characters." });
    }
    if (body.title.length > TITLE_MAX_LEN) {
      errors.push({ field: "title", message: `Title cannot exceed ${TITLE_MAX_LEN} characters.` });
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push({ field: "items", message: "At least one item is required." });
  } else {
    body.items.forEach((item, idx) => {
      if (!isPlainObject(item)) {
        errors.push({ field: `items[${idx}]`, message: `Item ${idx} must be an object.` });
        return;
      }

      if (typeof item.qty !== "number" || !(item.qty >= 1)) {
        errors.push({ field: `items[${idx}].qty`, message: "Quantity must be at least 1." });
      }

      checkOptionalString(errors, `items[${idx}].description`, item.description);
      checkOptionalString(errors, `items[${idx}].detail`, item.detail);

      const hasSupplier = item.supplierCostExVat != null;
      const hasUnit = item.unitPriceExVat != null;
      if (hasSupplier && hasUnit) {
        errors.push({
          field: `items[${idx}].price`,
          message: `Item ${idx}: provide either supplierCostExVat or unitPriceExVat, not both.`,
        });
      } else if (!hasSupplier && !hasUnit) {
        errors.push({
          field: `items[${idx}].price`,
          message: `Item ${idx}: provide either supplierCostExVat or unitPriceExVat.`,
        });
      } else {
        const field = hasSupplier ? "supplierCostExVat" : "unitPriceExVat";
        const value = hasSupplier ? item.supplierCostExVat : item.unitPriceExVat;
        if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
          errors.push({
            field: `items[${idx}].${field}`,
            message: `Item ${idx}: ${field} must be a positive, finite number.`,
          });
        }
      }
    });
  }

  checkOptionalString(errors, "intro", body.intro);
  checkOptionalString(errors, "summaryNote", body.summaryNote);
  checkOptionalString(errors, "attention", body.attention);

  if (body.extraTerms != null) {
    if (!Array.isArray(body.extraTerms) || !body.extraTerms.every((t) => typeof t === "string")) {
      errors.push({ field: "extraTerms", message: "extraTerms must be an array of strings." });
    }
  }

  if (body.validUntil != null) {
    if (typeof body.validUntil !== "string" || !isValidIsoDate(body.validUntil)) {
      errors.push({ field: "validUntil", message: "validUntil must be a valid yyyy-mm-dd date." });
    } else if (body.validUntil < isoDate(today)) {
      errors.push({ field: "validUntil", message: "validUntil cannot be before today." });
    }
  }

  return errors;
}

type BuiltSections = { sections: QuoteSection[]; internal: InternalRow[] };

/** Splits items into supply/recurring sections (built only when non-empty,
 *  numbered by position), computes each item's markup, and collects the
 *  staff-only internal supplier-cost rows keyed by the section layout this
 *  function itself builds. */
function buildSections(items: ApiQuoteItem[], actorLabel: string): BuiltSections {
  const supplyItems = items.filter((i) => !i.monthly);
  const recurringItems = items.filter((i) => i.monthly);

  const groups: {
    id: string;
    titleWord: string;
    subtitle: string;
    totalLabel: string;
    monthly?: true;
    sourceItems: ApiQuoteItem[];
  }[] = [];
  if (supplyItems.length) {
    groups.push({ id: "supply", titleWord: "Supply", subtitle: "Supply only", totalLabel: "TOTAL (incl VAT)", sourceItems: supplyItems });
  }
  if (recurringItems.length) {
    groups.push({
      id: "recurring",
      titleWord: "Monthly Services",
      subtitle: "Billed monthly",
      totalLabel: "TOTAL MONTHLY (incl VAT)",
      monthly: true,
      sourceItems: recurringItems,
    });
  }

  const sections: QuoteSection[] = [];
  const internal: InternalRow[] = [];

  groups.forEach((g, sIdx) => {
    const num = sIdx + 1;
    const quoteItems: QuoteItem[] = g.sourceItems.map((item, iIdx) => {
      const unitPrice =
        item.supplierCostExVat != null ? round2(item.supplierCostExVat * 1.15) : (item.unitPriceExVat as number);

      if (item.supplierCostExVat != null) {
        const path = `s${sIdx}.g0.i${iIdx}`;
        internal.push({
          path,
          supplierCost: round2(item.supplierCostExVat * item.qty),
          note:
            `Supplier cost R${item.supplierCostExVat} ex VAT per unit (via API by ${actorLabel}). ` +
            `Markup: cost × 1.15 = R${unitPrice} ex.`,
        });
      }

      return {
        description: item.description,
        detail: item.detail,
        qty: item.qty,
        unitPrice,
      };
    });

    sections.push({
      id: g.id,
      title: `Section ${num} — ${g.titleWord}`,
      subtitle: g.subtitle,
      totalLabel: g.totalLabel,
      ...(g.monthly ? { monthly: true as const } : {}),
      groups: [{ name: "", items: quoteItems }],
    });
  });

  return { sections, internal };
}

type DocParams = {
  title: string;
  items: ApiQuoteItem[];
  intro?: string | null;
  summaryNote?: string | null;
  extraTerms?: string[];
  attention?: string | null;
  client: ClientContext;
  today: Date;
  validUntilIso: string;
  actorLabel: string;
  checkout: boolean;
};

function buildDoc(p: DocParams): { doc: QuoteDoc; internal: InternalRow[] } {
  const { sections, internal } = buildSections(p.items, p.actorLabel);

  const generatedIntro = p.checkout
    ? `This quote covers ${p.title}, payable online by card. All prices exclude VAT (15%).`
    : `This quote covers ${p.title}. All prices exclude VAT (15%).`;
  const projectIntro = p.intro ?? generatedIntro;

  const paymentTerm = p.checkout ? CHECKOUT_PAYMENT_TERM : EFT_PAYMENT_TERM;
  const terms = [STANDARD_TERMS[0], STANDARD_TERMS[1], paymentTerm, ...STANDARD_TERMS.slice(3), ...(p.extraTerms ?? [])];

  const doc: QuoteDoc = {
    company: COMPANY,
    banking: BANKING,
    vatPercent: 15,
    client: {
      name: p.client.registeredName ?? p.client.name,
      attention: p.attention ?? p.client.attention ?? "",
      addressLines: p.client.addressLines ?? [],
    },
    meta: {
      quoteNumber: "",
      date: displayDate(p.today),
      validUntil: displayDate(new Date(`${p.validUntilIso}T00:00:00.000Z`)),
      preparedBy: p.actorLabel,
    },
    projectTitle: p.title,
    projectIntro,
    sections,
    ...(p.summaryNote != null ? { summaryNote: p.summaryNote } : {}),
    terms,
  };

  return { doc, internal };
}

export function assembleCreate(
  body: ApiCreateBody,
  client: ClientContext,
  opts: { today: Date; actorLabel: string },
): { ok: true; input: CreateQuoteInput; internalNotes: string[] } | { ok: false; errors: FieldError[] } {
  const errors = validateBody(body, opts.today);
  if (errors.length) return { ok: false, errors };

  const checkout = body.checkout ?? false;
  const validUntilIso = body.validUntil ?? isoDate(plusDays(opts.today, VALIDITY_DAYS));

  const { doc, internal } = buildDoc({
    title: body.title,
    items: body.items,
    intro: body.intro,
    summaryNote: body.summaryNote,
    extraTerms: body.extraTerms,
    attention: body.attention,
    client,
    today: opts.today,
    validUntilIso,
    actorLabel: opts.actorLabel,
    checkout,
  });

  const input: CreateQuoteInput = {
    clientId: client.id,
    title: body.title,
    doc,
    validUntil: validUntilIso,
    internal,
    checkoutEnabled: checkout,
    billingStartsNextMonth: body.billingStartsNextMonth ?? false,
  };

  return { ok: true, input, internalNotes: internal.map((i) => i.note) };
}

export function assembleAmend(
  body: ApiAmendBody,
  client: ClientContext,
  opts: { today: Date; actorLabel: string; checkout: boolean },
): { ok: true; input: AmendQuoteInput } | { ok: false; errors: FieldError[] } {
  const errors = validateBody(body, opts.today);
  if (errors.length) return { ok: false, errors };

  const validUntilIso = body.validUntil ?? isoDate(plusDays(opts.today, VALIDITY_DAYS));

  const { doc, internal } = buildDoc({
    title: body.title,
    items: body.items,
    intro: body.intro,
    summaryNote: body.summaryNote,
    extraTerms: body.extraTerms,
    attention: body.attention,
    client,
    today: opts.today,
    validUntilIso,
    actorLabel: opts.actorLabel,
    checkout: opts.checkout,
  });

  const input: AmendQuoteInput = { title: body.title, doc, validUntil: validUntilIso, internal };

  return { ok: true, input };
}
