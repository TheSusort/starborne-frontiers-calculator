# MCP spec 1 of 3: OAuth-issued tokens are read-only

Issue: #562. Status: design approved 2026-09-25.

## Where this sits

#562 exposes the calculator to AI assistants as a remote MCP server. The end goal: a player
describes a battle they are losing, an agent connected over MCP reads their fleet and runs the
combat simulator to find the stat ranges that win, and the player takes those ranges to autogear
(autogear itself is not an MCP tool).

Decided shape, in three specs built in order:

1. **This spec** — make every token Supabase issues to an OAuth client read-only at the database.
2. Auth plumbing — Supabase Auth as the OAuth 2.1 server (dynamic client registration), a consent
   route in the SPA, a stateless Netlify Function at `/mcp` (stateless Streamable HTTP, per
   https://developers.netlify.com/guides/write-mcps-on-netlify/) that verifies the caller's token and reads through RLS
   with it, `list_profiles` / `get_my_fleet` / static read tools, a per-`user_id` rate limit.
3. `simulate_battle` + `sweep_stat` — player side from fleet ship ids resolved through
   `calculateTotalStats`, enemy side from templates at an investment level; compact summaries,
   not raw logs. Builds on the existing simulator stat sweep
   (`docs/superpowers/specs/2026-09-14-simulator-stat-sweep-design.md`).

Transport-agnostic tool logic in `src/mcp/`; Netlify is the first adapter, stdio a dev harness.

## Problem

A token Supabase issues to an OAuth client is an ordinary Supabase JWT (`role: authenticated`) with
one extra claim, `client_id`. Website sessions do not carry `client_id`
(Supabase docs, "OAuth 2.1 Server → Token security"). RLS applies to OAuth tokens exactly as it
does to the user, so an approved client — including one that registered itself dynamically —
can do anything the user can over PostgREST:

- write or delete every user-owned table (ships, inventory_items, loadouts, …);
- call writing RPCs, several `SECURITY DEFINER`: `delete_user`, `increment_autogear_count`,
  `increment_import_count`, `upsert_heartbeat`;
- if the approving user is an admin, call admin RPCs (`approve_ship_template_proposal`,
  `activate_arena_season`, `refresh_system_snapshot`, …).

The MCP server only reads. The token must be unable to do more.

## Approach

A PostgREST pre-request hook: one function PostgREST runs before every Data API request. When the
JWT carries `client_id` and the method is not `GET` / `HEAD`, it raises and the request fails
with HTTP 403.

This is sufficient for the Data API because PostgREST runs `GET`/`HEAD` in a **read-only
transaction**: a `GET` on a table cannot write, and a `GET` on a volatile function fails. So
"no non-GET" means "no write", covering tables and RPCs alike, without touching a single RLS
policy.

Rejected: a helper referenced from every INSERT/UPDATE/DELETE policy. It misses RPCs entirely
(`SECURITY DEFINER` bypasses RLS), and prod's policies are not reliably in the repo
(`current-schema.sql` carries none, and most tables predate the tracked migrations), so a migration editing them
by name would be guessing.

## Migration

`supabase/migrations/20260925000001_oauth_clients_read_only.sql`:

```sql
CREATE OR REPLACE FUNCTION public.check_request()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  method text := current_setting('request.method', true);
BEGIN
  IF claims ? 'client_id' AND method NOT IN ('GET', 'HEAD') THEN
    RAISE SQLSTATE 'PT403'
      USING MESSAGE = 'OAuth client tokens are read-only',
            HINT = 'Sign in to the website to make changes.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_request() TO anon, authenticated;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_request';
NOTIFY pgrst, 'reload config';
```

- `claims ? 'client_id'` — key presence, so a `client_id` of `null` or `""` is still gated.
  A request with no JWT (anon) has no claims and passes.
- Not `SECURITY DEFINER`: it reads only `current_setting`, needs no privileges.
- `PT403` is PostgREST's custom-status SQLSTATE: the client sees 403, not 400/500.
- The header comment states the contract (OAuth tokens are read-only on the Data API) and names
  the verification snippet below as its check.

### Allowlist (not in this spec)

Spec 2's per-user MCP usage counter needs one RPC let through. It lands in spec 2 as an explicit
`AND NOT (method = 'POST' AND request path = that one RPC)` clause — one named exception, not a
general mechanism. Until spec 2 there is no exception.

## Consequences for spec 2

- The MCP server reads tables with `GET` (supabase-js `.select()` is already GET) and calls any
  read RPC with `supabase.rpc(name, args, { get: true })`; a default `.rpc()` is a POST and 403s.
- A 403 with message `OAuth client tokens are read-only` is expected behaviour, surfaced to the
  agent as "this tool cannot change your data", never retried.

## Apply order (the user runs all of this)

1. **Before applying**, check nothing already occupies the hook, since the `ALTER ROLE` replaces it:
   `select rolconfig from pg_roles where rolname = 'authenticator';` — if a `pgrst.db_pre_request`
   entry exists, stop; the two functions must be merged first.
2. Apply the migration.
3. Run the verification snippet; all four cases must behave as listed.
4. Only then (spec 2) enable the OAuth 2.1 server and "Allow Dynamic OAuth Apps".

## Verification

No local Supabase exists and the CLI is off-limits, so the check is a SQL-editor snippet the user
runs after applying. `set_config(..., true)` scopes to the transaction; the `ROLLBACK` leaves nothing behind.

```sql
BEGIN;
-- 1. OAuth token, write: must raise "OAuth client tokens are read-only"
SELECT set_config('request.jwt.claims', '{"sub":"x","role":"authenticated","client_id":"c"}', true),
       set_config('request.method', 'POST', true);
SELECT public.check_request();
ROLLBACK;

BEGIN;
-- 2. OAuth token, read: must return without error
SELECT set_config('request.jwt.claims', '{"sub":"x","role":"authenticated","client_id":"c"}', true),
       set_config('request.method', 'GET', true);
SELECT public.check_request();
-- 3. Website session, write: must return without error
SELECT set_config('request.jwt.claims', '{"sub":"x","role":"authenticated"}', true),
       set_config('request.method', 'PATCH', true);
SELECT public.check_request();
-- 4. Anon, no claims: must return without error
SELECT set_config('request.jwt.claims', '', true),
       set_config('request.method', 'POST', true);
SELECT public.check_request();
ROLLBACK;
```

Plus a smoke test of the live site after applying: sign in, save a loadout, import data. The hook
runs on every website request, so a mistake here breaks writes for everyone — the smoke test is
what catches it.

Repo-side: a vitest that reads the migration file and asserts it contains the `client_id` gate,
the `GET`/`HEAD` allowance and the `pgrst.db_pre_request` registration. It is a tripwire against
someone editing the function into a no-op, not proof of prod behaviour.

## Outside the Data API — open, checked in spec 2

The hook covers PostgREST only. Storage and Realtime: the app uses neither for user data. The Auth
API is the gap: whether an OAuth token can call `PUT /auth/v1/user` (change email, metadata) is not
documented. Spec 2 tests it empirically once DCR is on, with a harmless call (update
`user_metadata` only). If it succeeds, spec 2 must close it before anyone else is invited to
connect — candidate: a Custom Access Token Hook giving OAuth tokens a distinct `aud`, if the Auth
API rejects a non-default audience; to be confirmed then.

## Rollback

```sql
ALTER ROLE authenticator RESET pgrst.db_pre_request;
NOTIFY pgrst, 'reload config';
```

## Docs and changelog

No user-visible change on its own: no changelog entry, no DocumentationPage edit. Both land with
spec 2, when players can connect.
