-- Closes the RPC and table holes from the 2026-10-29 security review. Every function body below is
-- the live prod definition (pg_get_functiondef, 2026-10-29) with only the guard added, so nothing
-- edited in the dashboard since is reverted. Signatures are unchanged: the deployed client keeps
-- calling them with the same arguments.
--
-- Default privileges on public grant EXECUTE on every new function to anon, so each function here
-- states its grants explicitly.
--
-- 1. Admin dashboard reads (stats, traffic, table sizes, top users) were SECURITY DEFINER or
--    email-returning, callable by anon, with no admin check. They now answer admins only: plpgsql
--    functions raise, sql functions return no rows. get_daily_usage_stats / get_growth_stats cap
--    days_back, since generate_series over a caller-chosen span is a cheap way to load the database.
-- 2. is_user_admin(p_user_id) answered for any id. It now answers only about the caller.
-- 3. refresh_system_snapshot let any caller without auth.uid() through, meaning anon as well as
--    pg_cron. It now lets through only callers without a request JWT (pg_cron, the SQL editor).
-- 4. increment_autogear_count / increment_import_count updated whatever user_id they were given.
--    A user_id the caller has no profile access to is counted as the anonymous sentinel instead.
--    log_*_activity are internal helpers and lose their client grants.
-- 5. upsert_heartbeat trusted p_user_id and p_date, and took any session id. It now keeps only a
--    user id the caller has profile access to, stamps CURRENT_DATE, rejects oversized session ids,
--    and stops creating new sessions past a daily ceiling.
-- 6. approve/reject_ship_template_proposal had no caller check and recorded a caller-supplied
--    reviewer. They now require an admin and record auth.uid(). The owner UPDATE policy on
--    ship_template_proposals goes: it let a proposer set status or rewrite proposed_stats after
--    review. Proposal-count bumps on another user's proposal already matched no row under it.
-- 7. Free-text columns other players read get size bounds. NOT VALID: enforced on every new write,
--    existing rows are not rechecked.
--
-- Tripwire: src/__tests__/supabase/publicRpcLockdown.test.ts.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. Admin dashboard reads
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_daily_usage_stats(days_back integer DEFAULT 30)
 RETURNS TABLE(date date, total_autogear_runs integer, total_data_imports integer, unique_active_users integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        d.date,
        COALESCE(dus.total_autogear_runs, 0) as total_autogear_runs,
        COALESCE(dus.total_data_imports, 0) as total_data_imports,
        COALESCE(dus.unique_active_users, 0) as unique_active_users
    FROM (
        SELECT generate_series(
            CURRENT_DATE - LEAST(GREATEST(days_back, 0), 3650),
            CURRENT_DATE,
            '1 day'::interval
        )::DATE as date
    ) d
    LEFT JOIN daily_usage_stats dus ON d.date = dus.date
    ORDER BY d.date DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_growth_stats(days_back integer DEFAULT 30)
 RETURNS TABLE(date date, new_ships integer, new_gear integer, new_loadouts integer, new_users integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH windowed AS (
        SELECT snapshot_date,
               total_ships, total_inventory, total_loadouts, total_users,
               LAG(total_ships)     OVER w AS prev_ships,
               LAG(total_inventory) OVER w AS prev_inventory,
               LAG(total_loadouts)  OVER w AS prev_loadouts,
               LAG(total_users)     OVER w AS prev_users
        FROM public.system_health_snapshots
        WHERE snapshot_date >= CURRENT_DATE - (LEAST(GREATEST(days_back, 0), 3650) + 1)
        WINDOW w AS (ORDER BY snapshot_date)
    )
    SELECT snapshot_date                                                             AS date,
           GREATEST(total_ships     - COALESCE(prev_ships, total_ships), 0)          AS new_ships,
           GREATEST(total_inventory - COALESCE(prev_inventory, total_inventory), 0)  AS new_gear,
           GREATEST(total_loadouts  - COALESCE(prev_loadouts, total_loadouts), 0)    AS new_loadouts,
           GREATEST(total_users     - COALESCE(prev_users, total_users), 0)          AS new_users
    FROM windowed
    WHERE snapshot_date >= CURRENT_DATE - LEAST(GREATEST(days_back, 0), 3650)
      AND public.is_admin()
    ORDER BY snapshot_date ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_traffic()
 RETURNS TABLE(active_sessions bigint, authenticated_users bigint, anonymous_sessions bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::bigint AS active_sessions,
    COUNT(user_id)::bigint AS authenticated_users,
    COUNT(*) FILTER (WHERE user_id IS NULL)::bigint AS anonymous_sessions
  FROM heartbeats
  WHERE last_seen > now() - interval '60 seconds';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_system_stats()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT json_build_object(
        'total_ships',        total_ships,
        'total_inventory',    total_inventory,
        'total_loadouts',     total_loadouts,
        'total_encounters',   total_encounters,
        'total_users',        total_users,
        'total_active_users', total_active_users,
        'avg_ships_per_user', avg_ships_per_user,
        'avg_gear_per_user',  avg_gear_per_user,
        'snapshot_date',      snapshot_date,
        'updated_at',         updated_at
    )
    FROM public.system_health_snapshots
    WHERE public.is_admin()
    ORDER BY snapshot_date DESC
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_table_sizes()
 RETURNS TABLE(table_name text, row_count bigint, total_size text, table_size text, indexes_size text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  BEGIN
      IF NOT public.is_admin() THEN
          RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;

      RETURN QUERY
      SELECT
          (t.schemaname || '.' || t.relname)::TEXT AS table_name,
          t.n_live_tup AS row_count,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.relname))) AS total_size,
          pg_size_pretty(pg_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.relname))) AS table_size,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.relname)) - pg_relation_size(quote_ident(t.schemaname) || '.' ||
  quote_ident(t.relname))) AS indexes_size
      FROM pg_stat_user_tables t
      WHERE t.schemaname = 'public'
      ORDER BY pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.relname)) DESC
      LIMIT 20;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.get_top_active_users(limit_count integer DEFAULT 5)
 RETURNS TABLE(user_id uuid, email character varying, total_autogear_runs bigint, total_data_imports bigint, total_activity bigint, last_active timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        u.id as user_id,
        CASE
            WHEN u.id = '00000000-0000-0000-0000-000000000000'::uuid THEN 'Anonymous Users'::CHARACTER VARYING
            ELSE COALESCE(u.email, 'Unknown'::CHARACTER VARYING)
        END as email,
        COALESCE(u.autogear_run_count, 0)::BIGINT as total_autogear_runs,
        COALESCE(u.data_import_count, 0)::BIGINT as total_data_imports,
        (COALESCE(u.autogear_run_count, 0) + COALESCE(u.data_import_count, 0))::BIGINT as total_activity,
        u.updated_at as last_active
    FROM public.users u
    WHERE (u.autogear_run_count > 0 OR u.data_import_count > 0)
    ORDER BY total_activity DESC
    LIMIT limit_count;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 2. is_user_admin
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_user_admin(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN COALESCE(p_user_id = auth.uid(), false) AND public.is_admin();
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. refresh_system_snapshot
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_system_snapshot()
 RETURNS system_health_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row public.system_health_snapshots;
    v_total_ships        BIGINT;
    v_total_inventory    BIGINT;
    v_total_loadouts     BIGINT;
    v_total_encounters   BIGINT;
    v_total_users        BIGINT;
    v_total_active_users BIGINT;
    v_avg_ships          NUMERIC;
    v_avg_gear           NUMERIC;
BEGIN
    -- pg_cron and the SQL editor carry no request JWT; every Data API caller does, anon included.
    IF auth.jwt() IS NOT NULL AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Cheap approximate counts (same source as the old function).
    SELECT n_live_tup INTO v_total_ships      FROM pg_stat_user_tables WHERE relname = 'ships';
    SELECT n_live_tup INTO v_total_inventory  FROM pg_stat_user_tables WHERE relname = 'inventory_items';
    SELECT n_live_tup INTO v_total_loadouts   FROM pg_stat_user_tables WHERE relname = 'loadouts';
    SELECT n_live_tup INTO v_total_encounters FROM pg_stat_user_tables WHERE relname = 'encounter_notes';
    SELECT n_live_tup INTO v_total_users      FROM pg_stat_user_tables WHERE relname = 'users';

    -- Live aggregates. Depend on inventory_items autovacuum tuning from the hotfix.
    SELECT COUNT(DISTINCT user_id) INTO v_total_active_users FROM ships;

    SELECT COALESCE(AVG(c), 0) INTO v_avg_ships
    FROM (SELECT COUNT(*) c FROM ships GROUP BY user_id) s;

    SELECT COALESCE(AVG(c), 0) INTO v_avg_gear
    FROM (SELECT COUNT(*) c FROM inventory_items GROUP BY user_id) g;

    INSERT INTO public.system_health_snapshots AS s (
        snapshot_date, total_ships, total_inventory, total_loadouts, total_encounters,
        total_users, total_active_users, avg_ships_per_user, avg_gear_per_user
    ) VALUES (
        CURRENT_DATE, COALESCE(v_total_ships, 0), COALESCE(v_total_inventory, 0),
        COALESCE(v_total_loadouts, 0), COALESCE(v_total_encounters, 0),
        COALESCE(v_total_users, 0), v_total_active_users,
        ROUND(v_avg_ships, 2), ROUND(v_avg_gear, 2)
    )
    ON CONFLICT (snapshot_date) DO UPDATE SET
        total_ships        = EXCLUDED.total_ships,
        total_inventory    = EXCLUDED.total_inventory,
        total_loadouts     = EXCLUDED.total_loadouts,
        total_encounters   = EXCLUDED.total_encounters,
        total_users        = EXCLUDED.total_users,
        total_active_users = EXCLUDED.total_active_users,
        avg_ships_per_user = EXCLUDED.avg_ships_per_user,
        avg_gear_per_user  = EXCLUDED.avg_gear_per_user,
        updated_at         = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 4. Usage counters
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_autogear_count(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := CASE
        WHEN public.has_profile_access(increment_autogear_count.user_id)
            THEN increment_autogear_count.user_id
        ELSE '00000000-0000-0000-0000-000000000000'::uuid
    END;
BEGIN
    UPDATE users
    SET autogear_run_count = COALESCE(autogear_run_count, 0) + 1
    WHERE id = v_user_id;

    -- Log daily activity
    PERFORM log_autogear_activity(v_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_import_count(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := CASE
        WHEN public.has_profile_access(increment_import_count.user_id)
            THEN increment_import_count.user_id
        ELSE '00000000-0000-0000-0000-000000000000'::uuid
    END;
BEGIN
    UPDATE users
    SET data_import_count = COALESCE(data_import_count, 0) + 1
    WHERE id = v_user_id;

    -- Log daily activity
    PERFORM log_import_activity(v_user_id);
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 5. upsert_heartbeat
-- ---------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS heartbeats_date_idx ON public.heartbeats (date);

-- p_date stays in the signature for the deployed client and is ignored.
CREATE OR REPLACE FUNCTION public.upsert_heartbeat(p_session_id text, p_user_id uuid DEFAULT NULL::uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := CASE WHEN public.has_profile_access(p_user_id) THEN p_user_id END;
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) > 64 THEN
    RETURN;
  END IF;

  UPDATE public.heartbeats
     SET user_id = COALESCE(v_user_id, heartbeats.user_id),
         last_seen = now()
   WHERE session_id = p_session_id AND date = CURRENT_DATE;
  IF FOUND THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM public.heartbeats WHERE date = CURRENT_DATE) >= 50000 THEN
    RETURN;
  END IF;

  INSERT INTO public.heartbeats (session_id, user_id, date, last_seen)
  VALUES (p_session_id, v_user_id, CURRENT_DATE, now())
  ON CONFLICT (session_id, date)
  DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, heartbeats.user_id),
    last_seen = now();
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 6. Ship template proposals
-- ---------------------------------------------------------------------------------------------

-- admin_user_id stays in the signature for the deployed client and is ignored.
CREATE OR REPLACE FUNCTION public.approve_ship_template_proposal(proposal_id uuid, admin_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ship_id TEXT;
    v_proposed_stats JSONB;
    v_ship_name TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Get the proposal details
    SELECT ship_id, proposed_stats, ship_name
    INTO v_ship_id, v_proposed_stats, v_ship_name
    FROM ship_template_proposals
    WHERE id = proposal_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Update the ship template
    UPDATE ship_templates
    SET base_stats = v_proposed_stats,
        updated_at = NOW()
    WHERE id = v_ship_id;

    -- Mark proposal as approved
    UPDATE ship_template_proposals
    SET status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = auth.uid()::text,
        updated_at = NOW()
    WHERE id = proposal_id;

    RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_ship_template_proposal(proposal_id uuid, admin_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE ship_template_proposals
    SET status = 'rejected',
        reviewed_at = NOW(),
        reviewed_by = auth.uid()::text,
        updated_at = NOW()
    WHERE id = proposal_id AND status = 'pending';

    RETURN FOUND;
END;
$function$;

DROP POLICY IF EXISTS "Users can update own proposals" ON public.ship_template_proposals;

-- ---------------------------------------------------------------------------------------------
-- Grants for 1-6
-- ---------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_daily_usage_stats(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_growth_stats(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_live_traffic() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_system_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_table_sizes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_active_users(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_user_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_system_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_ship_template_proposal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_ship_template_proposal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_daily_usage_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_growth_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_traffic() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_table_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_active_users(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_system_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ship_template_proposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_ship_template_proposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;

-- Logged-out autogear runs, imports and heartbeats call these with the anon key.
GRANT EXECUTE ON FUNCTION public.increment_autogear_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_import_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_heartbeat(text, uuid, date) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.log_autogear_activity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_import_activity(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Size bounds on text other players read
-- ---------------------------------------------------------------------------------------------

ALTER TABLE public.encounter_notes
  ADD CONSTRAINT encounter_notes_name_size CHECK (octet_length(name) <= 400) NOT VALID,
  ADD CONSTRAINT encounter_notes_description_size
    CHECK (description IS NULL OR octet_length(description) <= 20000) NOT VALID,
  ADD CONSTRAINT encounter_notes_user_name_size
    CHECK (user_name IS NULL OR octet_length(user_name) <= 400) NOT VALID;

ALTER TABLE public.encounter_formations
  ADD CONSTRAINT encounter_formations_position_size CHECK (octet_length(position) <= 40) NOT VALID,
  ADD CONSTRAINT encounter_formations_ship_name_size
    CHECK (ship_name IS NULL OR octet_length(ship_name) <= 400) NOT VALID;

ALTER TABLE public.community_recommendations
  ADD CONSTRAINT community_recommendations_title_size CHECK (octet_length(title) <= 400) NOT VALID,
  ADD CONSTRAINT community_recommendations_description_size
    CHECK (description IS NULL OR octet_length(description) <= 4000) NOT VALID,
  ADD CONSTRAINT community_recommendations_reasoning_size
    CHECK (reasoning IS NULL OR octet_length(reasoning) <= 20000) NOT VALID,
  ADD CONSTRAINT community_recommendations_ship_name_size CHECK (octet_length(ship_name) <= 400) NOT VALID,
  ADD CONSTRAINT community_recommendations_ship_role_size CHECK (octet_length(ship_role) <= 100) NOT VALID,
  ADD CONSTRAINT community_recommendations_ultimate_implant_size
    CHECK (ultimate_implant IS NULL OR octet_length(ultimate_implant) <= 400) NOT VALID;

COMMIT;
