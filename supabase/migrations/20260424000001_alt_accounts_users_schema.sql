-- Alt accounts: schema changes to public.users.
-- Adds owner_auth_user_id (NULL = main, set = alt owned by that auth user).
-- Drops the FK to auth.users so alts can exist without an auth row.
-- Sets a uuid default on id so alt INSERTs can omit it.
-- Relaxes email to nullable + partial unique.

-- 1. Drop the FK from public.users.id -> auth.users.id.
--    The constraint name varies by environment; discover it dynamically.
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND (SELECT array_agg(attname ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = con.conrelid
             AND attnum = ANY(con.conkey)) = ARRAY['id'::name];

    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

-- 2. Default uuid generation for alt INSERTs that omit `id`.
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. Make email nullable.
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- 4. Replace the email unique constraint with a partial unique index
--    that ignores NULLs. Discover the existing constraint name dynamically.
DO $$
DECLARE
    uq_name text;
BEGIN
    SELECT con.conname INTO uq_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'u'
      AND (SELECT array_agg(attname ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = con.conrelid
             AND attnum = ANY(con.conkey)) = ARRAY['email'::name];

    IF uq_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', uq_name);
    END IF;
END $$;

-- Also drop any pre-existing UNIQUE INDEX on (email) that wasn't a constraint
-- (Supabase schemas vary: some define email uniqueness as a bare index).
-- Excludes partial indexes (WHERE clause) so our own users_email_unique_when_present
-- is not removed on re-runs.
DO $$
DECLARE
    idx_name text;
BEGIN
    SELECT indexname INTO idx_name
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%(email)%'
      AND indexdef NOT LIKE '%WHERE%';

    IF idx_name IS NOT NULL THEN
        EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_when_present
    ON public.users(email)
    WHERE email IS NOT NULL;

-- 5. Add owner_auth_user_id column (NULL for main accounts).
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS owner_auth_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- 6. Partial index for the alt lookup pattern.
CREATE INDEX IF NOT EXISTS users_owner_auth_user_id_idx
    ON public.users(owner_auth_user_id)
    WHERE owner_auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.users.owner_auth_user_id IS
    'NULL = main account (id matches auth.users.id). Non-NULL = alt account owned by that auth user.';
