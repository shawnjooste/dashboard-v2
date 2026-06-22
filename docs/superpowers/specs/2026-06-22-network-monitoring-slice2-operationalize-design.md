# Network Monitoring — Slice 2: Operationalize ("Make it Real")

**Date:** 2026-06-22
**Status:** Draft design, pending user review
**Project:** Rocking One Client Portal (dashboard-v2)
**Builds on:** Slice 1 (`2026-06-22-network-monitoring-slice1-gsr-design.md`) — shipped: schema, in-repo collector, GSR client Network view.

## Scope

Turn the proven GSR pilot from a manual script into a **secure, self-running daily service**. Two halves:

- **A — Automate:** the collector runs itself daily on the always-on Mac Mini (**jarvis**), not by hand.
- **B — Harden:** it writes through a `SECURITY DEFINER` ingestion RPC using a token scoped to that one function — so jarvis holds **no service-role key**.

**In scope**
- An `ingest_network_report` RPC that becomes the single write path (ports slice 1's JS upsert into the DB).
- A `network_ingest_targets` RPC so the collector learns what to pull without table read access.
- A `network_ingestor` Postgres role + a long-lived JWT scoped to those two functions.
- A standalone collector (no Portal repo, no service-role key) + a launchd job for jarvis.
- A staleness indicator on the Network page.

**Out of scope (later slices)**
- Fan-out to other Meraki orgs / UniFi sites; the admin NOC view (slice 3 — "make it wide").
- WAN/internet-health enrichment (slice — "make it rich").
- Failure alerting / email (deliberately excluded — in-app staleness is the whole failure story).

## Decisions (locked with user)

- **Runtime home:** Mac Mini `jarvis` (always on, vendor keys already at `~/.config/{meraki,unifi}/`). This session is on the MacBook, so the design **produces install artifacts**; the user installs them on jarvis.
- **Auth transport:** scoped Postgres role + JWT (not an edge function).
- **Failure handling:** in-app staleness only — no emails, no new alerting paths.
- **Schedule:** daily, ~02:00 local.

## Architecture

```
jarvis (always-on)                          Portal / Supabase
┌────────────────────────────┐
│ standalone collector        │  rpc() over   ┌──────────────────────────────────┐
│  1. network_ingest_targets()│◄─HTTPS+JWT───►│ network_ingest_targets()         │
│  2. pull Meraki + UniFi      │  (scoped to   │ ingest_network_report(jsonb)     │  SECURITY DEFINER
│  3. ingest_network_report()  │   2 funcs)    │   resolve alias→client, import_  │  (writes as owner)
│  vendor keys + ingestor JWT  │               │   run, upsert site/devices,      │
│  launchd: daily 02:00        │               │   write daily snapshot           │
└────────────────────────────┘               └──────────────────────────────────┘
   NO service-role key                          network_ingestor: EXECUTE on the
                                                two functions, nothing else
```

The write logic moves out of JS and into one DB function; the collector only normalizes and calls RPCs. The Mini's worst-case capability becomes "submit a network report."

## Components

### 1. `ingest_network_report(payload jsonb) → jsonb`
`SECURITY DEFINER`, `search_path = public`. Ports the slice-1 upsert. Payload (one source-site per call):
```json
{
  "source": "meraki" | "unifi_selfhosted",
  "source_key": "614741349136072776/L_643451796760566041",
  "site_name": "GSRLaw",
  "report_date": "2026-06-22",
  "client_count": 59,
  "devices": [
    { "source_device_id": "...", "name": "...", "kind": "gateway|switch|ap|other",
      "model": "...", "ip": "...", "status": "online|offline|alerting",
      "firmware": "...", "uptime_s": 123, "client_count": 14, "last_seen_at": "ISO" }
  ]
}
```
Logic, in one transaction:
1. Resolve `network_source_aliases(source, source_key) → client_id`. **Unknown ⇒ `raise exception` (the collector logs it, writes nothing)** — fail-safe, never guess.
2. Insert an `import_run` (`source = 'network:'||source`, `report_date`, `counts`).
3. Compute rollup: `devices_up/down`, site `status` (`offline` if all down, `degraded` if any down/alerting, else `online`), `last_seen` = max device `last_seen_at`.
4. Upsert `network_sites` on `(source, source_site_id)`; upsert `network_devices` on `(source, source_device_id)` from the array; upsert `network_health_snapshots` on `(site_id, snapshot_date)`.
5. Return `{ client_id, devices, up, down, status }`.
Idempotent: same report ⇒ identical state.

### 2. `network_ingest_targets() → setof (source, source_key, label)`
`SECURITY DEFINER`. Returns the alias list so the collector knows what to pull **without** any table read grant. Source of truth stays `network_source_aliases` (critical once fan-out adds dozens of sites).

### 3. `network_ingestor` role + JWT
Migration: `create role network_ingestor nologin; grant network_ingestor to authenticator; revoke all on all tables ...; grant execute on function ingest_network_report, network_ingest_targets to network_ingestor`. A one-time script mints a long-lived JWT `{ "role": "network_ingestor", "iss": "supabase", "exp": <far> }` signed (HS256) with the **project JWT secret** — *needed once from the user* (Supabase → Settings → API → JWT secret). The collector calls Supabase with the anon key as `apikey` and this JWT as `Authorization: Bearer`; PostgREST runs as `network_ingestor`, which can only execute the two functions.

### 4. Standalone collector (delivered as a folder for jarvis)
Self-contained — `collector.mjs`, `package.json` (just `@supabase/supabase-js`), `config.example.json`, `README.md`, `com.rocking.network-collector.plist`. No Portal repo, no service-role key. Flow:
1. `rpc('network_ingest_targets')` → targets.
2. For each target, run the matching adapter (Meraki manual-redirect auth; UniFi self-hosted login + `https.Agent({rejectUnauthorized:false})` scoped to UniFi) → normalized report.
3. `rpc('ingest_network_report', { payload })`.
4. Log to a rotating file; non-zero exit on any source failure (visible in launchd logs).
Reads vendor keys from `~/.config/{meraki,unifi}/`; reads Portal URL + anon key + ingestor JWT from its own config.

### 5. launchd schedule
A `LaunchAgent` plist (`StartCalendarInterval` 02:00 daily, `StandardOutPath`/`StandardErrorPath` to a log). README covers `launchctl load`/`bootstrap` + a manual `node collector.mjs` smoke test.

### 6. Staleness UI
`getClientNetwork()` already returns `lastSyncAt`. The Network page gains an amber banner — "⚠ Data may be stale — last synced {when}" — when `lastSyncAt` is older than ~36h. Healthy/fresh stays as-is.

## Migration of slice-1 collector
`scripts/network-pull.mjs` (in-repo, direct service-role) stays for **local testing/backfill**. Production runs the standalone collector on jarvis via the RPC. Both produce identical DB state (idempotent), so they can coexist during cutover.

## Error handling
- **Unknown alias** → RPC raises; collector logs that source-site, continues others, exits non-zero.
- **UniFi 401 (session expired)** → adapter re-logs in once and retries.
- **A source fails** → its report is skipped; other sources still ingest; the run exits non-zero so launchd logs show it.
- **Missed/failed day** → no new data; the Network page's staleness banner surfaces it.

## Testing
- **RPC idempotency** — call `ingest_network_report` twice with the same payload ⇒ identical rows, one snapshot per (site, date).
- **RPC unknown alias** — a bad `source_key` raises and writes nothing.
- **Scoped role** — the `network_ingestor` JWT can execute the two functions and **cannot** select/insert any `network_*` or other table directly.
- **Collector end-to-end** — run against GSR via the RPC ⇒ same 6 devices / 59 clients as slice 1.
- **Staleness UI** — backdate `last_seen_at` ⇒ banner appears.

## Build order
1. Migration: `ingest_network_report` + `network_ingest_targets` + `network_ingestor` role/grants.
2. Mint the ingestor JWT (needs the project JWT secret).
3. Verify both RPCs work under the scoped JWT (and that it can do nothing else).
4. Standalone collector folder + launchd plist + README; smoke-test it against GSR through the RPC.
5. Staleness banner on the Network page.
6. Hand off the jarvis install steps; confirm the first scheduled run.

## What's needed from the user
- The **project JWT secret** (once) to mint the ingestor token.
- Installing the collector folder + launchd job **on jarvis** (I produce everything; the actual `launchctl` runs there).
