# Connectivity pull (runs on Vision)

LibreNMS lives at `100.101.234.77` on the tailnet, so the portal (Vercel) can
never reach it. This script runs **on Vision itself**, polls LibreNMS over
localhost every 5 minutes, and writes each mapped line's ICMP status into
Supabase. The portal reads what's stored.

## What it writes

Per line (`connectivity_services` rows with a `librenms_device_id`):

- `last_up`, `latency_ms`, `loss_pct`, `last_checked_at`
- `down_since` — stamped on the first down poll, held while down, cleared on
  recovery. This is what makes "Down since 14:32" honest.
- one `connectivity_samples` row per poll (the 24-hour latency trend), pruned
  beyond 48 hours.

A device that fails to answer bumps `last_checked_at` only, leaving the previous
status intact — a monitoring blip must never render as a client outage. After
20 minutes without a successful poll the portal shows "Last checked …" instead
of a stale Online/Down pill.

## Setup

1. Copy `scripts/connectivity-pull.mjs` to the box, e.g.
   `/opt/rocking/connectivity-pull.mjs`.

2. Create `/etc/rocking/conn-pull.json`:

   ```json
   {
     "supabaseUrl": "https://eskhokedsximnslgsycs.supabase.co",
     "serviceKey": "<SUPABASE service_role key>",
     "librenmsUrl": "http://localhost",
     "librenmsKey": "<LibreNMS read-only API token>"
   }
   ```

   ```bash
   sudo install -d -m 700 /etc/rocking
   sudo chmod 600 /etc/rocking/conn-pull.json
   ```

   The service-role key bypasses RLS entirely — it must never be world-readable
   or land in a repo.

3. Test by hand:

   ```bash
   node /opt/rocking/connectivity-pull.mjs
   ```

   Expect: `connectivity pull: N ok, 0 failed, N lines @ <timestamp>`.

4. Schedule it (`crontab -e`):

   ```
   */5 * * * * /usr/bin/node /opt/rocking/connectivity-pull.mjs >> /var/log/rocking-conn-pull.log 2>&1
   ```

## Mapping lines to devices

In the portal: **Admin → Clients → \<client\> → Connectivity**, set each line's
**NMS id** to its LibreNMS device id. Lines without one show no status pill and
are skipped by the pull.

## Note on duplicated logic

`mapIcmp` and `nextDownSince` are copied into the script from
`lib/connectivity-helpers.ts` (plain node can't import the `.ts` file, and the
scripts deliberately have no build step). The `.ts` versions are the tested
source of truth — change both together.
