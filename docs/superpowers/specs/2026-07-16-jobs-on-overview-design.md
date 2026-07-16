# Jobs on the Admin Overview — Design

**Date:** 2026-07-16
**Status:** Approved (stale + waiting variant).

## Purpose

The Kanban (`/admin/jobs`) holds everything; the Overview should surface only
what's *sitting*. Add a "Jobs needing a nudge" panel and an OPEN JOBS KPI tile
to `/admin`.

## Decisions

- Panel lists: every open job in **waiting** (tag = its `waiting_note`, else
  "waiting") plus any other open job (`todo` / `in_progress`) with **no update
  for 7+ days** (tag = "stale Nd"). Waiting first, then stalest first.
- KPI tile **OPEN JOBS** = count of all todo/in_progress/waiting jobs; KPI row
  goes `lg:grid-cols-4` → `lg:grid-cols-5`.
- Panel rows link to `/admin/jobs` (no per-job pages exist). `hot` when
  non-empty. Empty copy: "Nothing stuck — the board is flowing."
- The nudge rule is a pure helper (`jobNudge(status, waitingNote, updatedAt, now)`
  → `null | { tag: string; rank: number }`) with vitest coverage; the view
  layer stays a thin query + map.
- No per-task detail, assignees, or board duplication.

## Changes

- `lib/views/admin-dashboard.ts`: add `jobs: DashPanel & { open: number }` to
  `AdminDashboard`; query `jobs` (id, title, client_id, status, waiting_note,
  updated_at) where status in (todo,in_progress,waiting) + client names
  (already fetched for other panels or reuse map).
- `lib/job-nudge.ts` (+ test): the pure rule.
- `app/(admin)/admin/page.tsx`: fifth KPI tile + sixth DashboardPanel.
