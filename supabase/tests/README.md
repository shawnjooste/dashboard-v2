# RLS tests

Two pgTAP suites assert the row-level-security scoping:

- `0001_rls_tenancy.test.sql` — domain-resolution trigger + client visibility.
- `0002_rls_devices.test.sql` — device scoping for staff / manager / member.

## Running with pgTAP (CI or local with Docker)

Requires the local Supabase stack (Docker):

    supabase start
    supabase test db

## Verifying without Docker (against the linked remote)

When Docker is unavailable, the same scenarios were verified against the linked
project by running the role-simulation inside a rolled-back transaction via the
Management API (`supabase db query --linked`). Confirmed results after the
0011 recursion fix:

- client_member  -> sees only their 1 assigned device
- client_manager -> sees their client's devices only (not other clients')
- rocking_staff  -> sees all devices
- no infinite-recursion error (42P17) on the devices policy
