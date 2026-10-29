-- New functions created by postgres are not executable by PUBLIC, in any schema.
--
-- PostgreSQL's built-in default grants EXECUTE on every new function to PUBLIC, and anon is a member
-- of PUBLIC. That default is global: an `IN SCHEMA` default privilege can only add grants, so the
-- schema-scoped revoke in 20261029000006 left it in place, and a new SECURITY DEFINER RPC granted
-- only to authenticated was still callable by anon. This revokes it globally for postgres.
-- authenticated and service_role keep their explicit schema-level defaults on public; a function a
-- logged-out caller needs must be granted to anon in its migration.
--
-- Verify after applying (expect anon_exec = false, auth_exec = true):
--   BEGIN;
--   CREATE FUNCTION public._default_acl_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
--   SELECT has_function_privilege('anon', 'public._default_acl_probe()', 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', 'public._default_acl_probe()', 'EXECUTE') AS auth_exec;
--   ROLLBACK;
--
-- Tripwire: src/__tests__/supabase/securityFollowups.test.ts.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
