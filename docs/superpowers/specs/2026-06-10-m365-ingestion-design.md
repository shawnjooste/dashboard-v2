# Microsoft 365 Ingestion — Design

**Date:** 2026-06-10
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Rocking supports client M365 tenants and wants per-tenant visibility (users, licenses, MFA,
security posture) in the portal. Verified live against GSR Law: Microsoft Graph is reachable with
**no Azure app registration** by using Microsoft's first-party "Microsoft Graph Command Line
Tools" public client (`14d82eec-204b-4c2f-b7e8-296a70dab67e`) + device-code flow, signing in as
the client's existing admin. A captured refresh token enables headless monthly pulls.

Capability map (Business-Premium tenant, no Entra P1):
- ✅ users, per-user licenses, SKU inventory, groups, devices, domains, directory roles
- ✅ security-defaults state (tenant-wide MFA headline), Conditional Access policy list, Secure Score
- ✅ per-user auth methods (→ strong-MFA flag) — works WITHOUT P1
- ❌ MFA registration report, signInActivity, Intune managedDevices — P1/Intune-gated (treated as
  optional enrichment: pulled when available, fields left null otherwise)

## Execution model

CLI, staff-run — mirrors the Datto ingestion. No web-initiated connect, no scheduled auto-pull in
v1 (the encrypted-token-in-Supabase design makes both additive later).

- **`scripts/m365-connect.mjs <clientId>`** — device-code sign-in (approve once as the client's
  M365 admin), encrypts the refresh token, upserts `m365_connections`. Run once per tenant.
- **`scripts/m365-pull.mjs <clientId> | --all`** — loads + decrypts the token, refreshes headlessly,
  pulls Graph, upserts current-state + writes a dated snapshot, opens an `import_runs` row
  (`source='m365'`). Run monthly.

Both read `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`M365_TOKEN_ENC_KEY`.

## Token encryption

App-level **AES-256-GCM** (Node `crypto`), key in new env var `M365_TOKEN_ENC_KEY` (32 random
bytes, base64; generated once, in `.env.local` + Vercel — **not** needed on Vercel for v1 since the
app never decrypts; CLI-only). `m365_connections` stores ciphertext, iv, auth-tag — never plaintext.
Encryption/decryption live ONLY in the CLI shared helper (the app never decrypts tokens), so they
sit in `lib/m365-graph.mjs` (plain ESM, importable by the `.mjs` CLIs). Unit-tested via Vitest
importing the `.mjs` (round-trip + GCM tamper-detection). Rationale: dependency-free, key lives
outside the DB (a DB leak alone doesn't expose tokens), same discipline as the service-role key.

**Module boundary rule (avoids `.ts`-in-`.mjs` import pain):** the CLIs are `.mjs` and cannot
import the app's `.ts` modules. So: CLI-only infra (device-code, Graph fetch, crypto) lives in
`lib/m365-graph.mjs`. The CLI stores **raw** Graph values (raw SKU part-numbers, raw auth-method
types) and computes only the two trivial bools inline (`is_licensed` = has licenses; `mfa_strong` =
has a non-password method). All **display** derivation (friendly SKU names, method labels, coverage
math) lives in the app's `.ts` modules and runs at read time — single source of truth, and adding a
SKU to the map instantly improves historical display.

## Schema (migration `0016_m365.sql`) — mirrors the Datto pattern

- **`m365_connections`** — `id`, `client_id` (unique, FK clients), `tenant_id`, `tenant_name`,
  `token_ciphertext`, `token_iv`, `token_tag` (all text), `last_pull_at timestamptz`,
  `status text default 'connected'`, timestamps. RLS: `is_rocking_staff()` only (read+write all);
  writes happen via service client regardless.
- **`m365_users`** — current state per Graph user: `client_id`, `m365_user_id` (Graph id),
  `display_name`, `user_principal_name`, `account_enabled bool`, `is_licensed bool`,
  `assigned_licenses text[]` (friendly SKU names), `mfa_methods text[]`, `mfa_strong bool`,
  `last_import_run_id`, timestamps. Unique `(client_id, m365_user_id)`.
- **`m365_licenses`** — per-client SKU inventory: `client_id`, `sku_part_number` (raw; friendly
  name derived on read), `total int`, `consumed int`, `last_import_run_id`. Unique
  `(client_id, sku_part_number)`.
- **`m365_tenant`** — per-client posture (one row per client): `client_id` PK, `security_defaults_on
  bool`, `ca_policy_count int`, `secure_score numeric`, `secure_score_max numeric`,
  `licensed_user_count int`, `mfa_strong_count int`, `last_import_run_id`, `updated_at`.
- **`m365_snapshots`** — dated rollup: `client_id`, `snapshot_date`, `licensed_users`,
  `mfa_coverage_pct`, `security_defaults_on`, `password_only_count`, `import_run_id`. Unique
  `(client_id, snapshot_date)`.
- RLS on the four data tables: staff all / manager their `client_id` / member their `client_id`
  (members see their org's M365 summary — acceptable; no per-user-row restriction needed since it's
  org posture data the manager view shows anyway. If we want member = own-row-only later, tighten
  then). For v1: staff all, client users (manager+member) read their own `client_id` rows.
- `set_updated_at` triggers on `m365_connections`, `m365_users`, `m365_tenant` (reuse existing fn).

## SKU name mapping — `lib/m365-skus.ts`

Static `Record<string,string>` for the common part-numbers (O365_BUSINESS_PREMIUM → "Business
Premium", O365_BUSINESS_ESSENTIALS → "Business Basic", EXCHANGESTANDARD → "Exchange Online (Plan 1)",
EXCHANGEENTERPRISE → "Exchange Online (Plan 2)", EXCHANGEARCHIVE_ADDON → "Exchange Online Archiving",
FLOW_FREE → "Power Automate Free", DYN365_BUSINESS_MARKETING → "Dynamics 365 Marketing",
SPB → "Microsoft 365 Business Premium", O365_BUSINESS → "Microsoft 365 Apps for Business",
ENTERPRISEPACK → "Office 365 E3", etc.) + `friendlySku(part)` returning the mapping or the raw code.

## Graph pull derivations — `lib/m365-derive.ts` (pure, tested)

- `isLicensed(user)` = `assignedLicenses.length > 0`.
- `mfaStrong(methods)` = any method type other than `password`/`passwordAuthenticationMethod`.
- `methodLabel(odataType)` → short label (microsoftAuthenticator, phone, fido2, windowsHello,
  softwareOath, email, …) for display; dedupe per user.
- `mfaCoveragePct(users)` = round(100 × strong&licensed / licensed), null if no licensed users.

## Dashboard

- **Sidebar:** client_manager + client_member get **Microsoft 365** `/m365`; admin reaches a
  client's M365 from the client drill-in (a section + a link, since admin is per-client).
- **`/m365`** (client surface, manager+member): the caller's own client M365 view.
- **`/admin/clients/[id]`**: add an **M365** section (or link to `/admin/clients/[id]/m365`) showing
  the same view for that client.
- Shared component `components/M365View.tsx` fed a `getM365View(clientId)` view-model
  (`lib/views/m365.ts`), RLS-scoped:
  - **Security headline** — security-defaults badge (ON/OFF), Secure Score (if present), CA policy
    count.
  - **MFA coverage** — "X of Y licensed users have strong MFA" + the **password-only list**.
  - **License usage** — per SKU consumed/total, maxed (consumed≥total) flagged.
  - **Accounts needing attention** — enabled-but-unlicensed; licensed-but-no-MFA.
  - **Trend** — sparkline of mfa_coverage_pct from snapshots once >1 exists.
- If a client has no `m365_connections` row: the view shows "Microsoft 365 isn't connected for this
  client yet."

## Error handling

- connect: device-code expiry / consent decline → clear CLI error, nothing written.
- pull: refresh-token invalid (admin revoked / 90-day lapse) → mark `m365_connections.status =
  'reauth_required'`, exit with a message telling staff to re-run connect; no partial wipe of
  existing current-state (last good data stays).
- Graph endpoint forbidden (P1/Intune) → skip that enrichment, continue; log what was skipped in
  the run `counts`.
- pull is idempotent: upserts on the unique keys; re-running the same month overwrites the snapshot
  for that date and refreshes current-state.

## Testing

- Pure unit tests: `lib/crypto.ts` (AES round-trip + tamper), `lib/m365-skus.ts` (mapping +
  fallback), `lib/m365-derive.ts` (isLicensed, mfaStrong, coverage edge cases).
- Live: `m365-pull.mjs <gsr-law-id>` using the existing saved token → verify rows land + a snapshot.
- build / tsc / lint green.

## Out of scope (v1)

Intune device inventory, signInActivity-based inactive-user detection, web-initiated connect,
scheduled auto-pull, per-user remediation actions, mailbox/SharePoint usage reports.

## Files

- Create: `supabase/migrations/0016_m365.sql`, `lib/m365-graph.mjs` (CLI device-code + Graph +
  AES crypto; + `lib/m365-graph.test.ts` for the crypto round-trip), `lib/m365-skus.ts` (+ test),
  `lib/m365-derive.ts` (+ test), `scripts/m365-connect.mjs`, `scripts/m365-pull.mjs`,
  `lib/views/m365.ts`, `components/M365View.tsx`, `app/(app)/m365/page.tsx`,
  `app/(admin)/admin/clients/[id]/m365/page.tsx`
- Modify: `lib/nav.ts` (Microsoft 365 item for manager+member), `app/(admin)/admin/clients/[id]/page.tsx`
  (link to M365), regenerate `lib/types/database.ts` after the migration.
