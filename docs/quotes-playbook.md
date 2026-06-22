# Quotes Playbook

How to create and send client quotes for Rocking through the Portal. A new
Claude Code session can work entirely from this doc — start it in this repo
(`/Users/shawnjooste/Documents/Claude/dashboard-v2`) and run everything here.

## Database (important)

- This Portal uses Supabase project ref **`eskhokedsximnslgsycs`**
  (`https://eskhokedsximnslgsycs.supabase.co`). Credentials are already in
  `./.env.local` (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `RESEND_API_KEY`). Never print or commit them.
- There is a **separate, unrelated** Supabase project called "Dashboard" (ref
  `qomxwxxulxcwnpaqzudl`) — that is **not** this one. Only ever use this repo's
  `.env.local`.

## The tool

Write a JSON file, then run:

```sh
node scripts/create-quote.mjs scripts/quote.json             # create + email the client's active managers
node scripts/create-quote.mjs scripts/quote.json --no-email  # create without emailing
node scripts/create-quote.mjs scripts/quote.json --amend <quoteId>   # new version of an existing quote
```

The script emails **every active `client_manager`** of the client. To reach only
specific people, use `--no-email` and email them separately, or make sure exactly
the right people are managers first.

## Input JSON shape

```jsonc
{
  "clientId": "<uuid>",          // or "clientName": "GSR Law"
  "title": "Short title",
  "validUntil": "2026-07-22",    // ISO date
  "number": "QU-GSR-006",        // optional; keep a client-prefixed series, else it auto-numbers
  "doc": {
    "vatPercent": 15,
    "company": { /* Rocking boilerplate below, verbatim */ },
    "client":  { "name": "...", "attention": "...", "addressLines": ["...", "..."] },
    "meta":    { "quoteNumber": "QU-GSR-006", "date": "22 June 2026", "validUntil": "22 July 2026", "preparedBy": "Shawn Jooste" },
    "projectTitle": "...",
    "projectIntro": "... All prices exclude VAT (15%).",
    "sections": [
      { "id": "supply", "title": "Section title", "subtitle": "optional", "totalLabel": "TOTAL (incl VAT)",
        "groups": [ { "name": "optional group header",
          "items": [ { "description": "...", "detail": "optional", "qty": 2, "unitPrice": 1150.00 } ] } ] }
    ],
    "summaryNote": "optional",
    "terms": [ "...", "..." ],
    "banking": { /* Rocking boilerplate below */ }
  },
  "internal": [ { "path": "s0.g0.i0", "supplierCost": 2000.00, "note": "what this cost is" } ]
}
```

- Multiple `sections` = priced options. A section with `"monthly": true` (or `id: "recurring"`) totals "/ month".
- `internal.path` is `s{section}.g{group}.i{item}`, all 0-indexed.

## THE MARKUP RULE (get this right every time)

**Client price (ex VAT) = supplier cost (incl VAT) = supplier cost (ex VAT) × 1.15.**

- Each line's `unitPrice` is the **client** price ex-VAT = your supplier ex-VAT cost × 1.15.
- In `internal`, `supplierCost` = the supplier **ex-VAT LINE TOTAL** (ex-VAT unit × qty). Staff-only; never shown to the client.
- If a supplier quote is **VAT-inclusive**, divide by 1.15 first to get the ex-VAT cost.

Worked: supplier ex-VAT R1000/unit, qty 2 → `unitPrice` 1150.00, `internal.supplierCost` 2000.00.

## Rocking boilerplate (use verbatim)

```json
"company": {
  "name": "Rocking (PTY) LTD",
  "addressLines": ["Unit A3, Westlake Square", "Westlake Drive, Westlake, 7945"],
  "vat": "4810312173",
  "regNumber": "2013/047237/07",
  "registeredOffice": "Unit A3, Westlake Square, Westlake Drive, Westlake, 7945, South Africa"
},
"banking": {
  "bank": "First National Bank",
  "branch": "Blue Route Mall, Tokai Road, Tokai, 7945",
  "account": "63023869192",
  "branchCode": "250655",
  "reference": "Please use quote number as payment reference."
}
```

`meta.preparedBy`: `"Shawn Jooste"` · `vatPercent`: `15`.

## Finding a client / its managers

To look up a client id, match a name, or list a client's **active managers**
(recipients), write a small Node script that loads `./.env.local` and queries the
`clients` and `profiles` (`role = 'client_manager'`, `status = 'active'`) tables
with `@supabase/supabase-js` (service-role client). Confirm the client and
recipients before sending.

## Always before sending a real quote

1. Show the line items, computed totals (subtotal, VAT, incl-VAT total), and the margin.
2. State exactly who it will email.
3. Flag if the supplier quote is expired or FX-sensitive (and add an FX/OEM caveat term).

Then send.
