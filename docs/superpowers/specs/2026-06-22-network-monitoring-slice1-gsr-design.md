# Network Monitoring — Slice 1: GSR Pilot (Meraki + UniFi)

**Date:** 2026-06-22
**Status:** Draft design, pending user review
**Project:** Rocking One Client Portal (dashboard-v2)
**Builds on:** the parked NMS design (memory `nms-network-monitoring-design`) and the Datto ingestion pattern (`docs/superpowers/specs/2026-06-09-rebuild-slice1-foundation-datto-design.md`).

## Scope

A thin, end-to-end vertical slice that ingests **GSR Law's** network from two sources and surfaces a calm, client-facing **Network** page. One pilot client, both adapters proven.

**In scope**
- Sources: **Meraki Dashboard API** + **UniFi self-hosted controller**.
- One client: **GSR Law** (existing Portal client) — already has logins (e.g. Monique).
- Client view altitude: **Option A** — traffic-light status + uptime + plain-English issues. No performance graphs, security feeds, or per-port detail.
- Daily batch cadence ("as of last sync", not live).

**Out of scope (later slices)**
- The other 8 Meraki orgs + 47 UniFi sites; UniFi cloud consoles (Cliff, Mackie).
- The boundary-B ingestion RPC for a *separate* collector repo (see "Architecture" — pilot uses a direct service-role upsert; the RPC wraps the same logic when the collector moves to the Mac Mini).
- Alerts/security/performance tables and views.
- Scheduling (the pilot collector is run manually; cron/Mac-Mini later).

## Real pilot data (probed 2026-06-22, read-only)

| Source | Site | Devices |
|---|---|---|
| Meraki | `GSRLaw` network, org RockingConnect (`614741349136072776`) | 1× MX64 gateway (serial `Q2KN-BU8X-ABNG`) |
| UniFi self-hosted | site `Gunstons` (`pckw6iu6`) | 2× US24P250 switches, 3× UAPL6 (U6+) APs — all online, 39d uptime, 57 active clients |

GSR's legacy firm name is **Gunstons** — that's why the UniFi site is named so.

## Architecture

Mirrors the Datto pattern: a local collector normalizes vendor data into the Portal's typed shapes and writes through an **idempotent upsert layer**, with every row anchored to an `import_run`.

```
Meraki API ─┐
            ├─► collector (scripts/, local) ─► idempotent upsert (service role) ─► Supabase ─► GSR "Network" page (RLS)
UniFi  API ─┘        normalize to typed rows
```

- **Collector** lives in dashboard-v2 (`ingest/network/` + a `scripts/network-pull.mjs` runner) for the pilot, run on the MacBook where the API keys live. Secrets are read from `~/.config/{meraki,unifi}/...` at runtime — never printed, hardcoded, or committed.
- **Pilot write path = direct service-role idempotent upsert** (the proven Datto approach, e.g. `datto-pull.mjs`), *not* the `ingest_network_report` RPC. **Rationale:** the collector is in-repo for the pilot, so a cross-repo RPC boundary buys nothing yet; the reusable core is the upsert logic. **Boundary B (the SECURITY DEFINER RPC) is introduced in the slice that moves the collector to the Mac Mini** — it will wrap exactly this upsert logic. *(Deviation from the parked "locked B" decision, deliberately deferred — flag for review.)*
- **Per source-site report:** the collector produces one normalized report per source-site (Meraki `GSRLaw`, UniFi `Gunstons`); each resolves to the GSR client via the alias table and upserts independently. GSR ends up owning devices from both.

## Data model (Slice 1 subset — extensible)

All client-scoped tables carry `client_id` and are RLS-protected (client sees own; staff see all).

- **`network_source_aliases`** — `(source, source_key) → client_id`, plus `label`. Maps a vendor site to a Portal client; unknown key ⇒ the collector stops and asks (never guesses). Pilot rows:
  - `('meraki', '614741349136072776/L_643451796760566041', GSR, 'GSRLaw')`
  - `('unifi_selfhosted', 'pckw6iu6', GSR, 'Gunstons')`
- **`network_sites`** — one row per source-site under a client: `id, client_id, source, source_site_id, name, status, device_count, client_count, last_seen_at, import_run_id`.
- **`network_devices`** — one row per device. Identity key **`(source, source_device_id)`** where `source_device_id` = serial (Meraki) / MAC (UniFi). Holds: `client_id, site_id, name, kind (gateway|switch|ap|other), model, ip, status (online|offline|alerting), firmware, uptime_s, client_count, last_seen_at, import_run_id`.
- **`network_health_snapshots`** — dated trend, one row per site per run: `snapshot_date, client_id, site_id, devices_total, devices_up, devices_down, client_count, status`. Replace on `(site, snapshot_date)`. Powers the uptime trend.
- **`import_runs`** — reuse; `source = 'network:meraki' | 'network:unifi_selfhosted'`, `report_date`, counts. Every network row references its run.

**Normalisation**
- `kind`: Meraki `MX*`→`gateway`; UniFi `usw`→`switch`, `uap`→`ap`.
- `status`: Meraki `online|offline|alerting|dormant` (dormant→offline); UniFi `state===1`→`online` else `offline`.
- `source_device_id`: Meraki serial; UniFi device MAC.

## Collector (two adapters)

1. **Meraki adapter** — `GET /networks/{GSRLaw}/devices` + `/organizations/{org}/devices/statuses` (filter to GSRLaw); follow redirects manually re-sending auth (Meraki cross-origin redirect strips `Authorization`).
2. **UniFi self-hosted adapter** — `POST /api/login` (session cookie; TLS verify off for the self-signed cert), then `/api/s/pckw6iu6/stat/device`, `/stat/health`, `/stat/sta` (client count). Detect `401` and re-login.

Each adapter emits typed device/site rows → upsert layer → one `network_health_snapshot` per site for the run → summary (devices created/updated, anything down/alerting).

**Safety:** idempotent (re-run ⇒ identical state), auditable (`import_run`), fail-safe on unknown alias (stop and ask).

## Client view — "Network" (Option A)

A new `Network` page in the client app shell, RLS-scoped:
- **Traffic light:** green "Healthy" when all devices online; amber "Issues" when any offline/alerting; red "Down" if the gateway/site is unreachable. Plain-English line ("All 6 devices online · 57 people connected").
- **Uptime:** % over the last 30 daily snapshots (sparkline).
- **Device list:** name, kind, status, last seen — friendly labels, no firmware/port noise.
- **"As of" stamp:** last sync time, with a staleness note if the daily run was missed.

Staff see the same data per client via the existing admin surface (a later slice adds the cross-client NOC roll-up).

## Error handling

- **Unknown alias** → collector stops, reports the unmapped source-site, writes nothing for it.
- **UniFi session expiry (401)** → re-login once, retry; else fail that source's report (Meraki still ingests).
- **Partial/malformed source data** → that source's report fails loudly with the offending site; no partial write.
- **Missed daily run** → view shows last good snapshot + "last synced N days ago".

## Testing

- **Normalisation** — unit tests: sample Meraki + UniFi payloads → expected typed rows (status/kind mapping).
- **Idempotency** — run the collector twice against the pilot ⇒ identical DB state, no dup devices.
- **RLS** — a GSR manager sees only GSR's `network_*` rows; another client sees none; staff see all.
- **End-to-end** — run collector → GSR "Network" page shows 6 devices, Healthy, ~57 clients.

## Build order

1. Schema migration (`network_*` tables + aliases) + RLS + reuse `import_runs`.
2. Upsert layer + normalisation (typed, shared with the view).
3. Meraki adapter, then UniFi self-hosted adapter; the `network-pull` runner.
4. Seed the two GSR aliases; run the collector against GSR.
5. Client "Network" page (Option A) + nav entry, RLS-scoped.
6. Verify end-to-end against the live GSR data.
