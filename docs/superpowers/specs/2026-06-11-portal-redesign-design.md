# The Portal v2 — visual redesign

**Status:** building (user approved autonomous build: "just spec it and build it and then push it").
**Source:** `The Portal v2.dc.html` (Cloudflare-style prototype) + standing design rules from the design pack `CLAUDE.md`.

## Goal

Apply a single, cohesive visual language across **every** page of the portal — both the
Rocking staff (admin) surface and the client surface — replacing the current bare-Tailwind
look. Where the prototype defines a richer pattern (people-first tables, plain-language
status), adopt it on the client surface. This is a **restyle of existing pages**, not new
backend features.

## Design language (tokens)

Encoded as Tailwind v4 `@theme` tokens in `app/globals.css` so pages read semantically
(`bg-card`, `border-line`, `text-brand`).

| Token | Value | Use |
|---|---|---|
| `canvas` | `#FAFAFB` | page background |
| `card` | `#FFFFFF` | card / sidebar / topbar |
| `line` | `#E4E4E7` | card + structural borders |
| `line-soft` | `#F0F0F2` | inner dividers (card header rule, table rows) |
| `ink` | `#18181B` | strong text, headings |
| `ink-2` | `#3F3F46` | body text |
| `ink-3` / `muted` / `faint` | `#52525B` / `#71717A` / `#A1A1AA` | descending de-emphasis |
| `brand` | `#D7141C` | primary actions, alerts, sparklines, active nav edge |
| `brand-dark` | `#B81016` | primary hover |
| `brand-tint` | `#FDECEC` | red wash (sparkline fill, waiting badge) |
| `good` | `#15803D` text / `#16A34A` dot / `#ECFDF3` tint / `#BBF7D0` line | healthy / on |
| `warn` | `#B45309` text / `#FEF3C7`,`#FFFBEB` tint / `#FDE68A` line / `#92400E` ink | needs attention |

- **Font:** Public Sans (Google) via `next/font`, weights 400/500/600/700. Replaces Geist.
- **Radii:** 8px cards, 6–7px buttons/rows, 99px pills.
- **Type scale:** 30px page title (-0.5px tracking), 16px/700 section, 13.5px body,
  12.5–12px meta, 11.5px/600 uppercase labels (0.5px tracking).

## Components (the system)

New primitives in `components/ui/`:

- **`Card` / `CardHeader`** — bordered white card (radius 8, `overflow-hidden`); header is an
  11px-padded row with a 13.5px/600 title, optional count pill and right-aligned `→` link.
- **`StatCard` / `StatGrid`** — the 3-up overview card: a header label, then a 2-up split
  (left cell has a right divider) of `{ label, value, foot }`, foot colorable
  (brand/good/warn). Optional sparkline slot.
- **`PageHeader`** — breadcrumb (`Account home › …`), 30px title, optional red primary
  action button (right), optional one-line subtitle.
- **`StatusPill` / `statusStyle()`** — dot + label with the green/amber/red mapping; one
  helper so every surface speaks the same status language.
- **`Avatar`** — initials circle (sizes sm/md), dark or neutral.
- **`Tabs`** — underline tab row (active = ink text + brand underline).
- **`Sparkline`** — existing component, restyled to brand stroke + brand-tint fill.

Shell:

- **`AppShell`** — 248px white sidebar (grouped nav + red active edge via
  `inset 3px 0 0 brand`), account footer (client/org name + user); 48px white topbar with
  Help/Support links + initials avatar; `canvas` main column, content max-width 1240px,
  padding `36px 40px`.
- **`Sidebar`** — consumes a **grouped** nav (uppercase group labels). `lib/nav.ts` gains
  `NavGroup[]` per role:
  - *rocking_staff:* Overview · **Clients:** Clients · **Services:** Microsoft 365 ·
    **Account:** Approvals, Support(ext)
  - *client_manager:* Devices · **Your services:** Microsoft 365 · **Account:** Team, Support
  - *client_member:* My machine · **Account:** Support

## Page treatments

Every page adopts `PageHeader` + `Card` primitives + the palette. Specific upgrades:

- **Client home (`/`)** — manager: StatGrid (Computers / Backups / Updates) over a
  people-first device table; member: their machine as cards. Plain language
  ("Backup overdue", not "agent stale").
- **Client M365 (`/m365`)** — StatGrid (Licences / Mailboxes / Sign-in security) + people
  table; MFA shown as "Two-step on / Not set up".
- **Devices (admin + client)** — device tables become the bordered-card table with status
  dots; admin keeps the person-link affordances.
- **Support list / detail / new** — list as card table with status pills; detail as
  conversation cards + details sidebar + reply box; new ticket as the category-chip form.
- **Admin pages** (overview, clients, client drill-in, people, M365 cockpit, approvals,
  link-devices) — same chrome, StatGrid for stat rows, Card tables. Admin keeps its denser,
  more technical labels (internal audience) but the same visual system.
- **Login** — Public Sans + palette, centered card.

## Out of scope (prototype screens with no backend)

Knowledge base, Email-security page, Products, Billing — the prototype mocks these with
static content. Not built now; nav omits them ("live items only"). Noted as future slices.

## Verification

`tsc --noEmit`, `eslint`, `vitest` (existing suites green), `next build`. Then a live pass
on the deployed branch. Push to `origin/main` (triggers Vercel) per the user's instruction.
