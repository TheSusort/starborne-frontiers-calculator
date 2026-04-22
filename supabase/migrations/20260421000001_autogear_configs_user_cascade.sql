-- Ensure autogear_configs cascades on user deletion so E2E cleanup
-- (admin.deleteUser) can remove test users cleanly. The previous
-- constraint used NO ACTION, which would block deletion whenever
-- a user had saved autogear configs.
--
-- Discovers the existing FK on public.autogear_configs.user_id without
-- assuming which table/schema it references — then re-creates it
-- pointing at the same target with ON DELETE CASCADE.

BEGIN;

DO $$
DECLARE
    existing_constraint text;
    ref_schema text;
    ref_table text;
    ref_column text;
BEGIN
    SELECT c.conname,
           rns.nspname,
           rc.relname,
           ra.attname
      INTO existing_constraint, ref_schema, ref_table, ref_column
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class sc        ON sc.oid = c.conrelid
      JOIN pg_catalog.pg_namespace sns   ON sns.oid = sc.relnamespace
      JOIN pg_catalog.pg_class rc        ON rc.oid = c.confrelid
      JOIN pg_catalog.pg_namespace rns   ON rns.oid = rc.relnamespace
      JOIN pg_catalog.pg_attribute sa
        ON sa.attrelid = c.conrelid
       AND sa.attnum = c.conkey[1]
      JOIN pg_catalog.pg_attribute ra
        ON ra.attrelid = c.confrelid
       AND ra.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND sns.nspname = 'public'
       AND sc.relname = 'autogear_configs'
       AND sa.attname = 'user_id'
     LIMIT 1;

    IF existing_constraint IS NULL THEN
        RAISE EXCEPTION 'No FK on public.autogear_configs.user_id was found';
    END IF;

    RAISE NOTICE 'Dropping constraint % (references %.%.%) and re-adding with ON DELETE CASCADE',
        existing_constraint, ref_schema, ref_table, ref_column;

    EXECUTE format(
        'ALTER TABLE public.autogear_configs DROP CONSTRAINT %I',
        existing_constraint
    );

    EXECUTE format(
        'ALTER TABLE public.autogear_configs ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES %I.%I(%I) ON DELETE CASCADE',
        existing_constraint, ref_schema, ref_table, ref_column
    );
END $$;

COMMIT;
