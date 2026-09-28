# Block account email and phone changes at the database

Issue: #562 (MCP). Status: approved in outline 2026-09-28.

## Why

The MCP rollout probe (`scripts/oauth-probe.ts`, run 2026-09-28) showed that a token Supabase
issues to an OAuth client can call the Auth API directly:

| Check | Result |
|---|---|
| `PUT /auth/v1/user { data }` | 200 — ALLOWED |
| `PUT /auth/v1/user { email }` | 200 — ALLOWED; the account got a pending `new_email` |
| Data API write | 403 `PT403` — BLOCKED (the pre-request hook) |

**Hard requirement (user): an MCP/OAuth token must never change the account email.** The
pre-request hook only covers PostgREST; the Auth API (GoTrue) runs its own updates on `auth.users`
as `supabase_auth_admin`, so no request-level claim reaches the database there, and Supabase has
no "before user updated" hook or scope that restricts `/user`.

The app itself never changes an email or phone: it signs in with Google only and never calls
`auth.updateUser` (`git grep updateUser` finds only the unrelated `updateUserProfile`). So an email
or phone change is never legitimate from any client, and the rule can be enforced for every token.

## Approach

A `BEFORE UPDATE` trigger on `auth.users` that rejects any update which **starts** an email or
phone change: `email_change` or `phone_change` set to a non-empty value different from before.
GoTrue's change flow writes the pending address to those columns first and only copies it into
`email`/`phone` on confirmation, so blocking the pending write blocks the whole flow. Clearing them
(to `''`/`NULL`) stays allowed, so an existing pending change can still be cancelled.

Not blocked, deliberately:
- `email` / `phone` themselves — Google sign-in and admin dashboard edits may write `email`
  directly; a direct write needs the service role, which no client holds.
- `raw_user_meta_data` — Google sign-in refreshes the name and avatar there on each sign-in. An
  OAuth token can overwrite them (display name and avatar URL only); accepted.

This relies on email confirmation being on (Authentication → Providers → Email → Confirm email /
Secure email change). With it off, GoTrue writes `email` directly and never sets `email_change`,
and the trigger does not fire. The probe's state-based check (below) catches that: it also reports
ALLOWED when `email` itself changed. The migration header names this dependency.

Supabase still allows user-defined triggers on `auth.users` after its 2025 auth-schema
restrictions; some projects report `42501` (postgres does not own `auth.users`) — if applying the
migration fails that way, stop and report.

## Migration

`supabase/migrations/20260928000001_block_account_email_change.sql`:

```sql
CREATE OR REPLACE FUNCTION public.block_account_contact_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(NEW.email_change, '') <> ''
     AND NEW.email_change IS DISTINCT FROM OLD.email_change THEN
    RAISE EXCEPTION 'Changing the account email is disabled'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(NEW.phone_change, '') <> ''
     AND NEW.phone_change IS DISTINCT FROM OLD.phone_change THEN
    RAISE EXCEPTION 'Changing the account phone is disabled'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_account_contact_change ON auth.users;
CREATE TRIGGER block_account_contact_change
  BEFORE UPDATE OF email_change, phone_change ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_account_contact_change();
```

Header comment: the contract (no client may start an email/phone change; the app has no such
feature), the pointer to the probe as its end-to-end check, and the rollback.

Rollback: `DROP TRIGGER block_account_contact_change ON auth.users;`

## Probe change

A trigger rejection surfaces from GoTrue as a 5xx, which today's verdict rules score INCONCLUSIVE.
The email-change verdict becomes **state-based**: after the `PUT`, the probe reads
`GET /auth/v1/user` and inspects `new_email`.

- `new_email` or `email` equals the probe address → **ALLOWED** (regardless of the PUT's status).
- `new_email` absent/different, the PUT was non-2xx, and both token checks were 2xx → **BLOCKED**.
- Anything else (token not valid before/after, PUT 2xx but no pending change) → **INCONCLUSIVE**.

Pure helper, unit-tested for each branch. `metadata-update` keeps its status-based verdict and is
reported, but it no longer blocks lifting the admin gate (only its display fields are exposed).

## Tests

- `src/__tests__/supabase/blockAccountContactChange.test.ts` — tripwire on the migration text, like
  the pre-request hook's: the function checks `email_change` and `phone_change` with the
  non-empty + `IS DISTINCT FROM` condition, raises, and the trigger is `BEFORE UPDATE … ON
  auth.users`; no later migration drops it.
- `src/__tests__/scripts/oauthProbe.test.ts` — the new email-change verdict branches.

## Rollout (the user)

1. Clear the pending change the probe started (does not touch the confirmed email):
   `update auth.users set email_change = '', email_change_token_new = '', email_change_token_current = '', email_change_sent_at = null where id = '03daacdb-66a5-4034-af97-0ab5a9a4e614';`
2. Apply the migration. If it fails with `42501`, stop.
3. Smoke test: sign out, sign in with Google, save a loadout.
4. Re-run the probe (`npx tsx scripts/oauth-probe.ts --probe-email <address you control>`); it must
   print `email-change: BLOCKED`. Then delete the probe's OAuth app in the dashboard.
5. `email-change: BLOCKED` satisfies the requirement for lifting the admin gate (a separate PR).

No changelog entry: nothing a player sees.
