-- A token Supabase Auth issues to an OAuth client (#562: MCP clients) carries a `client_id`
-- claim; a website session does not. This PostgREST pre-request hook makes such a token
-- read-only on the Data API: any request other than GET/HEAD is rejected with HTTP 403.
--
-- GET/HEAD are sufficient to allow because PostgREST runs them in a read-only transaction,
-- so a GET can neither write a table nor run a volatile function. That covers RLS-bypassing
-- SECURITY DEFINER RPCs too, which is why the rule lives here and not in table policies.
--
-- Scope: the Data API only. Auth, Storage and Realtime do not run this hook.
--
-- Registering replaces any existing pgrst.db_pre_request; check
--   select rolconfig from pg_roles where rolname = 'authenticator';
-- before applying. Verification snippet and rollback: the spec,
-- docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md.
-- Tripwire: src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts.

CREATE OR REPLACE FUNCTION public.check_request()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  method text := current_setting('request.method', true);
BEGIN
  -- Key presence, not value: a null or empty client_id is still an OAuth token.
  IF claims ? 'client_id' AND method NOT IN ('GET', 'HEAD') THEN
    RAISE SQLSTATE 'PT403'
      USING MESSAGE = 'OAuth client tokens are read-only',
            HINT = 'Sign in to the website to make changes.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_request() TO anon, authenticated;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_request';
NOTIFY pgrst, 'reload config';
