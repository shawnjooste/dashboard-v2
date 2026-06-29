# Concargo — client agent

Per-client agent folder. Today it does one thing: refresh **Concargo's** Datto data in the
portal (devices, storage, patch status, open alerts, daily health snapshot), scoped to
Concargo's Datto site only — it never touches another client's data.

## Run
From the repo root, with `.env.local` present (Datto + Supabase service-role keys):

```bash
node clients/concargo/sync.mjs
```

That runs the canonical pull scoped to Concargo (`scripts/datto-pull.mjs --site "Concargo"`)
and upserts into the same tables the portal reads, so the admin Devices view updates.

## Config — `config.json`
| key | value |
|---|---|
| `displayName` | Concargo |
| `clientId` | `9b4aca31-9aad-4437-bce5-66a8e7916708` |
| `dattoSiteName` | `Concargo` (must match the Datto site + the `site_aliases` row) |

## Adding another client
Copy this folder, rename it, and change the three values in `config.json`. The runner and the
underlying pull are shared — nothing else to write.

## Roadmap
This is **Layer 1 (ingestion)** of the client-agent plan — keep the portal's per-client picture
fresh. Layer 2 (a scheduled rules loop that opens tickets for issues) and Layer 3 (an on-demand
per-client LLM agent) build on top of this data. See the client-agent design docs.
