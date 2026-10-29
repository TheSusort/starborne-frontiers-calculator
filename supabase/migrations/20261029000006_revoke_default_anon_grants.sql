-- New tables, sequences and functions in public are no longer granted to anon by default.
--
-- Supabase's default privileges granted every new object to anon (and EXECUTE on every new function
-- to PUBLIC), so an object was reachable by logged-out callers unless a migration remembered to
-- revoke. Now each migration grants anon explicitly where a logged-out caller needs it. authenticated
-- and service_role keep their defaults. Objects that already exist keep their current grants.
--
-- Applies to objects created by postgres, which is the role migrations and the SQL editor run as.
--
-- Verify after applying (expect no anon entry and no "=X/" PUBLIC entry for public):
--   SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl
--    WHERE defaclnamespace = 'public'::regnamespace;
--
-- Tripwire: src/__tests__/supabase/securityFollowups.test.ts.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
