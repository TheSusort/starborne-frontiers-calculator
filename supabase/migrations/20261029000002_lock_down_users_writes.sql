-- Locks down what a client may write to, and read from, public.users.
--
-- 1. INSERT. The live "insert_users_policy" was WITH CHECK (true), and permissive policies OR
--    together, so any signed-in user could insert any users row. With the escalation guard firing
--    on UPDATE only, two requests made anyone an admin: re-key your own row away (the UPDATE policy
--    allows it while owner_auth_user_id is yourself), then INSERT {id: <you>, is_admin: true}.
--    It is replaced by a policy for the one row a client legitimately creates itself: its own main
--    profile (`migratePlayerData`). Alts keep "Users can insert alt profiles they own"; arcade guest
--    rows are created inside SECURITY DEFINER functions, which no policy here applies to.
--
-- 2. The guard trigger now fires on INSERT and UPDATE, and also freezes id, owner_auth_user_id and
--    email for client roles. email is trusted as identity (`scripts/admin-import.ts` looks accounts
--    up by it; the unique index means a claimed address blocks the owner's own sign-up), so a
--    client may only ever store its own JWT email, on its main row, at creation.
--    The guard applies only when current_user is a client role (anon / authenticated). The SQL
--    editor, service_role scripts and SECURITY DEFINER functions run as other roles and pass, which
--    is how admin promotion in the dashboard keeps working.
--
-- 3. SELECT. "... or public profiles" let every signed-in user (arcade guests included) read every
--    column of every public profile: email, is_admin, owner_auth_user_id. RLS filters rows, not
--    columns. No client feature reads another user's row directly (leaderboards are SECURITY
--    DEFINER RPCs), so the public branch goes. The one direct read was the username-availability
--    check, which moves to is_username_available().
--
-- Tripwire: src/__tests__/supabase/usersWriteLockdown.test.ts.
--
-- Verify after applying (expect: no insert_users_policy, the trigger on INSERT and UPDATE):
--   SELECT policyname, permissive, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'users' ORDER BY cmd, policyname;
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal;

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. INSERT
-- ---------------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "insert_users_policy" ON public.users;
DROP POLICY IF EXISTS "Users can insert own main profile" ON public.users;
CREATE POLICY "Users can insert own main profile" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND owner_auth_user_id IS NULL
    AND is_admin = false
  );

-- ---------------------------------------------------------------------------------------------
-- 2. Guard trigger
-- ---------------------------------------------------------------------------------------------

-- SECURITY INVOKER so current_user is the role that issued the write; public.is_admin() is
-- SECURITY DEFINER itself and still resolves auth.uid() from the request JWT.
CREATE OR REPLACE FUNCTION public.prevent_is_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_admin IS TRUE THEN
            RAISE EXCEPTION 'Insufficient privileges to modify is_admin'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.email IS NOT NULL
           AND (NEW.owner_auth_user_id IS NOT NULL
                OR NEW.email IS DISTINCT FROM (auth.jwt() ->> 'email')) THEN
            RAISE EXCEPTION 'A profile may only store its own account email'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN NEW;
    END IF;

    IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin) AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Insufficient privileges to modify is_admin'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.owner_auth_user_id IS DISTINCT FROM OLD.owner_auth_user_id
       OR NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'id, owner_auth_user_id and email cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_is_admin_escalation_trigger ON public.users;
CREATE TRIGGER prevent_is_admin_escalation_trigger
    BEFORE INSERT OR UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.prevent_is_admin_escalation();

-- ---------------------------------------------------------------------------------------------
-- 3. SELECT
-- ---------------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own, owned alts, or public profiles" ON public.users;
DROP POLICY IF EXISTS "Users can view own profile or owned alts" ON public.users;
CREATE POLICY "Users can view own profile or owned alts" ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR owner_auth_user_id = auth.uid());

-- Same answer the client's direct read gave before (exact match, the caller's own row counts as
-- taken), without exposing the row.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.users WHERE username = p_username);
$$;

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated;

COMMIT;
