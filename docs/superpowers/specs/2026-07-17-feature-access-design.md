# Per-User Feature Access — Design

**Date:** 2026-07-17
**Status:** Approved in conversation (Shawn).

## Purpose

Access today = role. Some clients want managers who can't see Billing (or
Quotes, etc.). Add per-user feature overrides on top of roles: role sets the
defaults, unticks subtract. Staff manage it on the existing Users page.

## Model

- `profiles.feature_overrides jsonb null` — e.g. `{"billing": false}`. Null =
  pure role defaults. Only `false` overrides matter in v1 (subtractive);
  granting a member extra sections is out of scope.
- **Features (gateable client sections):** `billing`, `quotes`, `team`,
  `devices`, `m365`, `network`. Account home and Support are never gateable
  (a user who can't reach support is a support ticket).
- **Role defaults:** manager → all features on; member → none (matches
  today's member nav: My machine + Support only).
- Pure helper `canAccess(role, overrides, feature): boolean` +
  `allowedFeatures(role, overrides): Set<string>` in an import-free file,
  vitest-covered. Staff always passes.

## Enforcement layers

1. **Nav** — `AppShell`/nav filtering takes the user's allowed feature set
   (extends the existing `billingEnabled` mechanism; nav items map to feature
   keys).
2. **Pages + actions** — each gated page checks `canAccess` server-side and
   redirects home; the section's server actions check the same before writing.
3. **RLS (money data only, v1):** a `has_feature(text)` SECURITY DEFINER
   helper reads the caller's overrides; wired into the client-read policies of
   `xero_invoices` and `client_billing` (billing) and `quotes` /
   `quote_versions` / `quote_events` (quotes). Devices/M365/network/team stay
   page-gated only in v1 — operational data, lower stakes, revisit if needed.
   This distinction is deliberate and documented: hiding nav is cosmetic; for
   money data the database itself must refuse.

## Admin UI

On `/admin/users`, each client user row gets an **Access** editor (popover or
inline row expansion): six checkboxes prefilled from role defaults + overrides;
saving writes `feature_overrides` via a staff-guarded action (only stores keys
that differ from role defaults; all-default → null). Members show the same UI
but v1 subtractive semantics mean their boxes are informational (all off).

## Interactions

- The support-packages fork also touches nav/support gating — whichever session
  builds second reads the other's spec. This feature does NOT gate `/support`.
- Impersonation: staff viewing as a user sees that user's gated nav (the gates
  read the impersonated profile — automatic, since gates read the profile).

## Testing

- Vitest: canAccess/allowedFeatures matrix (role defaults, overrides, staff
  bypass, unknown feature keys ignored).
- Manual + programmatic: manager with billing unticked → no Billing nav, /billing
  redirects, PostgREST query with their JWT returns zero xero_invoices rows;
  re-tick → restored. Member unchanged. Admin editor round-trips overrides.

## Out of scope (v1)

Additive grants for members, per-client policies, gating Support/home, RLS
for non-money sections, audit trail of permission changes (activity feed logs
could come later).
