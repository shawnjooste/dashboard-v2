# Connectivity Slice 2 — Settings, Description & Live ICMP

**Date:** 2026-07-24
**Status:** Approved in conversation (Shawn).
**Builds on:** `docs/superpowers/specs/2026-07-20-connectivity-design.md` (slice 1 — shipped).

## Purpose

Slice 1 gave connectivity clients an inventory and a status pill that has never
lit up (LibreNMS was unreachable). Slice 2 makes the page genuinely useful:
what the line's settings actually are, a human description, and real ICMP
health from LibreNMS — now living on **Vision (100.101.234.77), Tailscale-only**,
which forces a pull architecture.

## Decisions

- **Pull, not live proxy.** LibreNMS is tailnet-only, so the portal can never
  reach it. `scripts/connectivity-pull.mjs` runs **on Vision itself** every 5
  minutes (localhost API, no tailnet hop) and writes status into Supabase. The
  page reads stored status. Slice 1's `lib/librenms.ts` live proxy is retired.
- **ICMP + 24h trend** (not full SNMP/traffic): status, latency, packet loss
  now, plus a 24h latency sparkline. Per-port SNMP traffic graphs are slice 3 —
  they need per-line port mapping, which doubles admin effort.
- **PPPoE password stored encrypted, visible to the client's managers.** It is
  their credential; self-service beats phoning us. AES-256-GCM, the scheme
  already used for M365/Xero tokens; key in env, never in the DB; revealed
  on demand via a server action, never in the initial HTML.
- **Service-role key on Vision** is a deliberate, flagged trade-off: the pull
  needs to write to Supabase and a narrow write-only RPC is more machinery than
  this earns. Mitigation: credentials file `chmod 600`, owned by the account
  running the job; documented in the runbook section below.

## Data model

Migration `0070_connectivity_slice2.sql` (VERIFY the next free number at build
time — the parallel support session reached 0069).

Columns on `public.connectivity_services`:

| column | type | note |
|---|---|---|
| `description` | text | human description of the link |
| `conn_type` | text not null default `'dhcp'` check in (`pppoe`,`static`,`dhcp`) | drives which settings render |
| `pppoe_username` | text | |
| `pppoe_secret` | jsonb | `{ciphertext, iv, tag}` (base64) — never plaintext |
| `ip_address`, `subnet_mask`, `gateway`, `dns_servers` | text | static settings; `dns_servers` comma-separated |
| `vlan` | int | optional |
| `last_up` | boolean | last poll result |
| `latency_ms` | numeric | last ICMP average |
| `loss_pct` | numeric | last ICMP loss |
| `last_checked_at` | timestamptz | when the pull last wrote |
| `down_since` | timestamptz | set on first down poll, cleared on recovery |

New table `public.connectivity_samples`: `id`, `service_id` (fk cascade),
`at timestamptz default now()`, `up boolean`, `latency_ms numeric`,
`loss_pct numeric`; index `(service_id, at desc)`. The pull deletes rows older
than 48h for the lines it touched, so the table stays small without a cron.

RLS: `connectivity_samples` mirrors `connectivity_services` — staff all;
clients select samples whose parent service is theirs **and active**. The
existing service policies already cover the new columns (no policy change), but
`pppoe_secret` must NEVER be selected by client-facing queries — the view layer
selects explicit column lists, and the decrypt path is the only reader.

## Encryption — `lib/secrets.ts` (new, server-only)

TS mirror of `lib/m365-graph.mjs`'s AES-256-GCM helpers so Next.js can decrypt:
`encryptSecret(plaintext: string, keyBase64: string): {ciphertext, iv, tag}`
and `decryptSecret(payload, keyBase64): string`. Key: `CONNECTIVITY_ENC_KEY`
(32 random bytes, base64). Missing key → encrypt/decrypt throw; the admin form
refuses to save a password and the reveal action returns an error string
rather than crashing the page.

## Pull — `scripts/connectivity-pull.mjs` (runs on Vision)

1. Read `connectivity_services` where `librenms_device_id is not null` and
   `is_active` (service key).
2. Per device: `GET {LIBRENMS_URL}/api/v0/devices/{id}` for up/down; latency +
   loss from the device's ICMP data (LibreNMS exposes ping stats on the device
   payload / `/devices/{id}/graphs` metadata — confirm exact fields against the
   live API on Vision during build and pin the mapping in a pure helper).
3. Write back per line: `last_up`, `latency_ms`, `loss_pct`,
   `last_checked_at = now()`, and `down_since` — set to now on the first down
   poll (only when currently null), cleared to null on recovery.
4. Insert one `connectivity_samples` row per line; delete that line's samples
   older than 48h.
5. Log a one-line summary; never throw on a single-device failure (that line
   gets `last_up = null` semantics: leave prior values, only bump
   `last_checked_at` — a monitoring blip is not an outage).

Schedule: cron on Vision, `*/5 * * * *`. Credentials read from a
`chmod 600` file (Supabase URL + service key + LibreNMS token), never inline.

## UI

**Client `/connectivity`** — each line card gains:
- description paragraph (when set);
- **Settings block**: PPPoE (username + masked password with a **Reveal**
  button) or Static (IP / mask / gateway / DNS) or "Automatic (DHCP)"; VLAN
  when set;
- **Live row**: `Online · 12 ms · 0% loss · checked 2m ago`, or
  `Down since 14:32`, or `Last checked 14:05` when the newest check is older
  than 20 minutes (stale, never faked); plus a 24h latency `Sparkline` when
  there are ≥2 samples.

Reveal is a server action (`revealPppoeSecret(serviceId)`) guarded by: staff, or
a manager of that client **with the `connectivity` feature**; returns the
plaintext once, to that request only.

**Admin client card** — same fields in the add/edit form (conn type selector
shows the relevant inputs), plus the live row so staff see what clients see.
Editing a line is needed now that there are many fields: the existing
`updateLine` action gets an edit form (expandable row), replacing
retire-and-re-add.

## Testing

- Vitest (pure): ICMP payload → `{up, latencyMs, lossPct}` mapping incl.
  malformed/missing; `down_since` transition rule (null→now on first down,
  preserved while down, cleared on up); staleness rule (>20 min → stale);
  settings-block selection by `conn_type`; encrypt→decrypt round-trip.
- Manual/programmatic: seed a line with each conn type; run the pull against
  Vision and confirm status + samples land; reveal works for a manager and is
  refused for a member/other client (real-JWT check like the feature-access
  proof); page renders correctly with no samples, stale samples, and a
  simulated outage.

## Runbook (Vision setup — Shawn)

1. `CONNECTIVITY_ENC_KEY` (base64 32 bytes) into `.env.local` **and** Vercel.
2. On Vision: Node + this script, credentials file `chmod 600`
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LIBRENMS_URL=http://localhost`,
   `LIBRENMS_API_KEY`), cron `*/5 * * * *`, log to `/var/log/rocking-conn-pull.log`.
3. Map each line's LibreNMS device id on the admin card as clients are added
   to LibreNMS.

## Out of scope (slice 3+)

SNMP/interface traffic graphs and per-port mapping, availability % / uptime
reporting, outage history list, alerting or notifications, client-editable
settings, multi-WAN failover representation.
