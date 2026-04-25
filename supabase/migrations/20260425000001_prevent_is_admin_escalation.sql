-- Prevent non-admin users from self-promoting to admin via UPDATE.
--
-- The users UPDATE RLS policy only checks row ownership (auth.uid() = id),
-- which means any authenticated user could run:
--   supabase.from('users').update({ is_admin: true }).eq('id', <own-id>)
-- and the policy would pass. This trigger fires before every UPDATE on
-- public.users and rejects any attempt to change the is_admin column by
-- a caller who is not already an admin.
--
-- Uses SECURITY DEFINER so auth.uid() in the called is_admin() function
-- always refers to the JWT user making the request (not the definer).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS prevent_is_admin_escalation_trigger ON public.users;
--   DROP FUNCTION IF EXISTS public.prevent_is_admin_escalation();

CREATE OR REPLACE FUNCTION public.prevent_is_admin_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin) AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Insufficient privileges to modify is_admin'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_is_admin_escalation_trigger ON public.users;
CREATE TRIGGER prevent_is_admin_escalation_trigger
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.prevent_is_admin_escalation();
