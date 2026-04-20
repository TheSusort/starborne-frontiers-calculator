-- Fix: new user signup fails with "Database error saving new user"
--
-- The trigger function public.insert_user() runs on auth.users INSERT as the
-- supabase_auth_admin role. Without SECURITY DEFINER it executes in INVOKER
-- mode, so the INSERT into public.users is subject to RLS. The existing
-- insert_users_policy is scoped TO authenticated, which does not match
-- supabase_auth_admin, so the INSERT is blocked with:
--   ERROR: new row violates row-level security policy for table "users"
--
-- Fix: recreate as SECURITY DEFINER. postgres (the function owner) has
-- BYPASSRLS, so the INSERT succeeds regardless of policies. search_path is
-- pinned to public to prevent search_path injection.

CREATE OR REPLACE FUNCTION public.insert_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$;
