-- No token may set or replace the password of a confirmed account (#562). A token Supabase Auth
-- issues to an OAuth client (MCP) can call PUT /auth/v1/user { password } directly: on a Google
-- account that adds an email+password login that outlives the OAuth grant and is not read-only,
-- and on an email+password account it replaces the password. The app has no change-password or
-- forgot-password flow (it never calls auth.updateUser), so no in-app feature writes a new
-- password to an existing confirmed account.
--
-- The rule is a BEFORE UPDATE trigger on auth.users for the same reason as
-- block_account_contact_change (20260928000001): GoTrue writes the table itself as
-- supabase_auth_admin, and no request claim reaches the database there, so the trigger cannot
-- tell an OAuth client's session from a first-party one and blocks every caller.
--
-- Allowed, deliberately (GoTrue paths, supabase/auth internal/api and internal/models):
--   - Clearing the password (to NULL or ''): RemoveUnconfirmedIdentities and SoftDeleteUser.
--   - Any write while the account is unconfirmed (OLD has no email_confirmed_at or
--     phone_confirmed_at): accepting an invite sets a temporary password before confirming. An
--     unconfirmed account cannot sign in, so it cannot hold a token.
--   - The soft-delete transition (deleted_at NULL -> set), which only the admin API performs.
-- Blocked with it: admin and dashboard password resets. To reset one, drop the trigger, reset,
-- and re-run this migration.
--
-- Depends on:
--   - DB encryption of passwords being OFF (GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT). With it on,
--     every email+password sign-in rewrites encrypted_password with a new ciphertext, this
--     trigger rejects that, and email sign-in fails for everyone. Encrypted values are JSON
--     (start with '{'); bcrypt values start with '$2'. Check before applying:
--       select left(coalesce(encrypted_password, ''), 2) as prefix, count(*)
--       from auth.users group by 1;
--     Any '{"' row: stop, do not apply.
--   - The grants below, for the same reason as 20260928000001.
--
-- Also redefines public.block_account_contact_change() to allow the soft-delete transition:
-- SoftDeleteUser writes obfuscated hashes into email_change and phone_change, which the original
-- definition rejected, so an admin soft delete failed.
--
-- End-to-end check: `npx tsx scripts/oauth-probe.ts --password-set` must print
-- `password-set: BLOCKED`.
-- Tripwire: src/__tests__/supabase/blockAccountPasswordChange.test.ts.
-- Rollback: DROP TRIGGER block_account_password_change ON auth.users;

CREATE OR REPLACE FUNCTION public.block_account_password_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF (OLD.email_confirmed_at IS NOT NULL OR OLD.phone_confirmed_at IS NOT NULL)
     AND coalesce(NEW.encrypted_password, '') <> ''
     AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    RAISE EXCEPTION 'Changing the account password is disabled'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_account_password_change() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS block_account_password_change ON auth.users;
CREATE TRIGGER block_account_password_change
  BEFORE UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_account_password_change();

CREATE OR REPLACE FUNCTION public.block_account_contact_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
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
