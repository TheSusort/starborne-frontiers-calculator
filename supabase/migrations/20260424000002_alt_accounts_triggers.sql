-- Alt accounts: triggers for cascade-on-auth-delete and soft cap of 5 alts.

-- Replaces the cascade behavior previously provided by the FK
-- public.users.id -> auth.users(id), AND extends it to clean up alts.
CREATE OR REPLACE FUNCTION public.handle_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Delete the user's main profile (cascades through ships/inventory/etc).
    DELETE FROM public.users WHERE id = OLD.id;
    -- Delete all alts owned by this auth user.
    DELETE FROM public.users WHERE owner_auth_user_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
    AFTER DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_delete();

-- Soft cap: max 5 alts per owner. Enforced at the DB so nothing can bypass.
CREATE OR REPLACE FUNCTION public.enforce_alt_account_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_alts integer;
BEGIN
    IF NEW.owner_auth_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO existing_alts
    FROM public.users
    WHERE owner_auth_user_id = NEW.owner_auth_user_id;

    IF existing_alts >= 5 THEN
        RAISE EXCEPTION 'Alt account limit reached (max 5 per owner)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_alt_account_cap_trigger ON public.users;
CREATE TRIGGER enforce_alt_account_cap_trigger
    BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.enforce_alt_account_cap();
