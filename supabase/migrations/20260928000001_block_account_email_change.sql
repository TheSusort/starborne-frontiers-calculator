-- No client may start a change of the account email or phone (#562). The app has no such
-- feature: it signs in with Google only and never calls auth.updateUser. So a pending change
-- is never legitimate, whichever token asks for it: a website session, or a token Supabase Auth
-- issues to an OAuth client (MCP), which can call PUT /auth/v1/user directly.
--
-- The rule is a BEFORE UPDATE trigger on auth.users because the Auth API (GoTrue) writes that
-- table itself, as supabase_auth_admin; no request-level claim or pre-request hook reaches it.
-- GoTrue's change flow writes the pending address to email_change / phone_change and copies it
-- into email / phone only on confirmation, so rejecting the pending write blocks the whole flow.
-- Clearing a pending change (to '' or NULL) stays allowed, so one can still be cancelled.
-- email, phone and raw_user_meta_data are deliberately not guarded: see the spec.
--
-- Depends on:
--   - Email confirmation / Secure email change being ON (Authentication -> Providers -> Email).
--     With it off, GoTrue writes email directly, never sets email_change, and this trigger does
--     not fire.
--   - The grants below: the trigger runs as supabase_auth_admin, and without USAGE on public and
--     EXECUTE on the function every auth.users update naming these columns errors, which breaks
--     sign-in for everyone.
--
-- If applying this fails with 42501 (postgres does not own auth.users), stop and report; do not
-- work around it.
--
-- End-to-end check: `npx tsx scripts/oauth-probe.ts --probe-email <address>` must print
-- `email-change: BLOCKED`. Rationale and rollout: the spec,
-- docs/superpowers/specs/2026-09-28-block-account-email-change-design.md.
-- Tripwire: src/__tests__/supabase/blockAccountContactChange.test.ts.
-- Rollback: DROP TRIGGER block_account_contact_change ON auth.users;

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

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.block_account_contact_change() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS block_account_contact_change ON auth.users;
CREATE TRIGGER block_account_contact_change
  BEFORE UPDATE OF email_change, phone_change ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_account_contact_change();
