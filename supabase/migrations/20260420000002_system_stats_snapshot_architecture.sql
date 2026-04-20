-- Replaces live-compute get_system_stats / get_growth_stats with snapshot-driven
-- implementations. A daily pg_cron job (plus an admin "Refresh now" path) populates
-- system_health_snapshots; reads become an indexed single-row / N-row lookup.
--
-- Prerequisite: the VACUUM + autovacuum tuning for inventory_items must be deployed,
-- so the seed call at the bottom completes within the statement timeout.

-- 1. Write path: compute live, upsert today's row.
CREATE OR REPLACE FUNCTION public.refresh_system_snapshot()
RETURNS public.system_health_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    -- Allow when the caller is pg_cron (no auth.uid()) or an admin.
    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin)
    THEN
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
$$;

-- 2. Read path: latest snapshot.
CREATE OR REPLACE FUNCTION public.get_system_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    ORDER BY snapshot_date DESC
    LIMIT 1;
$$;

-- 3. Read path: day-over-day diffs for growth.
CREATE OR REPLACE FUNCTION public.get_growth_stats(days_back INT DEFAULT 30)
RETURNS TABLE (
    date         DATE,
    new_ships    INT,
    new_gear     INT,
    new_loadouts INT,
    new_users    INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    WITH windowed AS (
        SELECT snapshot_date,
               total_ships, total_inventory, total_loadouts, total_users,
               LAG(total_ships)     OVER w AS prev_ships,
               LAG(total_inventory) OVER w AS prev_inventory,
               LAG(total_loadouts)  OVER w AS prev_loadouts,
               LAG(total_users)     OVER w AS prev_users
        FROM public.system_health_snapshots
        WHERE snapshot_date >= CURRENT_DATE - (days_back + 1)
        WINDOW w AS (ORDER BY snapshot_date)
    )
    SELECT snapshot_date                                                             AS date,
           GREATEST(total_ships     - COALESCE(prev_ships, total_ships), 0)          AS new_ships,
           GREATEST(total_inventory - COALESCE(prev_inventory, total_inventory), 0)  AS new_gear,
           GREATEST(total_loadouts  - COALESCE(prev_loadouts, total_loadouts), 0)    AS new_loadouts,
           GREATEST(total_users     - COALESCE(prev_users, total_users), 0)          AS new_users
    FROM windowed
    WHERE snapshot_date >= CURRENT_DATE - days_back
    ORDER BY snapshot_date ASC;
$$;

-- 4. Schedule daily refresh at 03:00 UTC. Idempotent via unschedule+schedule.
SELECT cron.unschedule('refresh-system-snapshot')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-system-snapshot');

SELECT cron.schedule(
    'refresh-system-snapshot',
    '0 3 * * *',
    $$SELECT public.refresh_system_snapshot();$$
);

-- 5. Seed today's snapshot so the admin panel has data immediately post-deploy.
SELECT public.refresh_system_snapshot();
