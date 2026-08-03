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

## Setup (as deployed on Vision — 2026-07-30)

Vision is a **headless Mac**; LibreNMS runs in Docker under colima and is
exposed on `http://localhost:8000`. There is no GUI login session, so
LaunchAgents don't load reliably — the box already uses **cron**, so this does
too. No sudo is needed anywhere.

Current deployment:

| thing | where |
|---|---|
| script | `~/rocking/connectivity-pull.mjs` |
| config | `~/.config/rocking/conn-pull.json` (mode 600, dir 700) |
| node | `/opt/homebrew/bin/node` (installed via Homebrew) |
| log | `~/Library/Logs/rocking-conn-pull.log` |
| schedule | user crontab, `*/5 * * * *` |

Config shape:

```json
{
  "supabaseUrl": "https://eskhokedsximnslgsycs.supabase.co",
  "serviceKey": "<SUPABASE service_role key>",
  "librenmsUrl": "http://localhost:8000",
  "librenmsKey": "<LibreNMS API token>"
}
```

The service-role key bypasses RLS entirely — keep the file mode 600 and out of
any repo.

The LibreNMS token is a dedicated one, described in LibreNMS as
`rocking-portal-connectivity-pull` (Settings → API, or the `api_tokens` table).
Revoke that row to cut the portal's access without touching other integrations.

Crontab line:

```
*/5 * * * * ROCKING_CONN_CONF=/Users/shawnjooste/.config/rocking/conn-pull.json /opt/homebrew/bin/node /Users/shawnjooste/rocking/connectivity-pull.mjs >> /Users/shawnjooste/Library/Logs/rocking-conn-pull.log 2>&1
```

Test by hand:

```bash
ssh vision
ROCKING_CONN_CONF=~/.config/rocking/conn-pull.json /opt/homebrew/bin/node ~/rocking/connectivity-pull.mjs
```

Expect: `connectivity pull: N ok, 0 failed, N lines @ <timestamp>`.

### Redeploying after a change

```bash
scp scripts/connectivity-pull.mjs vision:~/rocking/connectivity-pull.mjs
```

## Why the ping here is authoritative (important)

LibreNMS runs in Docker under colima, and **colima's user-mode networking
answers ICMP for every address**. From inside the container, `fping` reports
0% loss at ~0.4 ms to `192.0.2.1`, `198.51.100.77` and `203.0.113.254` —
reserved TEST-NET addresses that cannot exist. The practical consequence:

> **Every ping-only device in LibreNMS reads "up", including ones that are
> unreachable.** This affects LibreNMS's own alerting too, not just the portal.

So this script does its own `ping` from the macOS host (which routes
correctly) and that result decides up/down. LibreNMS is used only to look up
which host an id refers to. When our ping can't produce a verdict we record
**unknown**, never "up" — the portal would rather show "no reading" than a
false green.

If SNMP-polled devices are added later, revisit: for those LibreNMS is the
better authority.

## ping must be called by absolute path

`ping` lives at **/sbin/ping** on macOS, which is *not* on cron's PATH
(`/usr/bin:/bin`). Calling it by name worked when run by hand and silently
failed with ENOENT under cron — so scheduled runs recorded no measurement and
fell back to LibreNMS's false "up". The script now resolves an absolute path
and shouts if it can't find one; the crontab also sets PATH. Test changes the
way cron will run them:

```bash
env -i HOME=$HOME PATH=/usr/bin:/bin ROCKING_CONN_CONF=$HOME/.config/rocking/conn-pull.json \
  /opt/homebrew/bin/node ~/rocking/connectivity-pull.mjs
```

## What LibreNMS actually returns

`GET /api/v0/devices/{id}` gives `status` (boolean), `last_ping_timetaken`
(milliseconds) and `last_ping`. It does **not** return `ping_avg`/`ping_loss` —
those are null on this deployment, and packet loss lives in the `device_perf`
table, which the API doesn't expose. So latency comes from
`last_ping_timetaken`, and packet loss is normally absent (the portal hides the
row rather than showing a fake zero). A down device reports `0`, which the
mapper treats as "no measurement", not "0 ms".

## Mapping lines to devices

In the portal: **Admin → Clients → \<client\> → Connectivity**, set each line's
**NMS id** to its LibreNMS device id. Lines without one show no status pill and
are skipped by the pull.

## Note on duplicated logic

`mapIcmp` and `nextDownSince` are copied into the script from
`lib/connectivity-helpers.ts` (plain node can't import the `.ts` file, and the
scripts deliberately have no build step). The `.ts` versions are the tested
source of truth — change both together.
