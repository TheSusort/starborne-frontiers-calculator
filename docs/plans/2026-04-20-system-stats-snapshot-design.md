# System Stats Snapshot Architecture — Design

**Date:** 2026-04-20
**Status:** Draft
**Prerequisite:** VACUUM + autovacuum hotfix for `inventory_items` (separate PR)

## Problem

The admin panel's `get_system_stats` RPC was timing out (Postgres `57014`, statement timeout at ~8s). Root cause was two-fold:

1. `inventory_items` has 500k+ rows with wide JSONB, and the function computed `AVG(gear_count) FROM (GROUP BY user_id)` live on every admin page load.
2. The stale visibility map on `inventory_items` caused an otherwise index-only scan to fall back to 146k heap fetches (confirmed via `EXPLAIN ANALYZE`).

A hotfix (`VACUUM (ANALYZE) public.inventory_items` + `autovacuum_vacuum_scale_factor = 0.05`) drops the query from 8.8s → 2.2s with heap fetches → 0. That unblocks the immediate bug but the cost still grows linearly with inventory size; at ~1M rows we are back at the timeout.

The schema already includes a `system_health_snapshots` table with every column the admin panel needs, but nothing writes to or reads from it. This design makes use of it.

## Goals

- Admin panel load no longer does live aggregates over `ships` or `inventory_items`.
- Stat-freshness SLO: at most one day stale automatically, with a one-click manual refresh for "I want current numbers right now".
- Same client-visible JSON shape for `get_system_stats` and `get_growth_stats` — no app-layer refactoring beyond adding a refresh button and a "last updated" label.

## Non-goals

- Historical backfill of snapshot rows. No per-day historical data exists to reconstruct; today-forward is enough.
- Cron failure alerting. Out of scope for this PR; may layer onto the existing `system_alerts` table later.
- Replacing `get_table_sizes`. It inherently needs `pg_stat_user_tables`/`pg_total_relation_size` live — leave it alone.

## Design

### Data flow

```
┌─────────────────┐       ┌──────────────────────┐
│  pg_cron daily  │──────▶│ refresh_system_      │
│   @ 03:00 UTC   │       │    snapshot()        │
└─────────────────┘       │  (SECURITY DEFINER)  │
                          │                      │
┌─────────────────┐       │  Computes live,      │
│ "Refresh now"   │──────▶│  upserts today's     │
│  button (admin) │       │  row into            │
└─────────────────┘       │  system_health_      │
                          │  snapshots           │
                          └──────────┬───────────┘
                                     │ writes
                                     ▼
                          ┌──────────────────────┐
                          │ system_health_       │
                          │   snapshots          │
                          │ (one row per date)   │
                          └──────────┬───────────┘
                                     │ reads (O(1) / O(days))
                                     ▼
                 ┌───────────────────┴─────────────────────┐
                 ▼                                         ▼
        ┌─────────────────┐                      ┌─────────────────┐
        │ get_system_     │                      │ get_growth_     │
        │  stats()        │                      │  stats(days)    │
        │ → latest row    │                      │ → last N rows   │
        └─────────────────┘                      └─────────────────┘
```

Three moving parts:

1. **`refresh_system_snapshot()`** — the only function that does the expensive live computation. Upserts into `system_health_snapshots` keyed on `snapshot_date` (already `UNIQUE` in the schema). Called by both pg_cron and the admin button.
2. **`get_system_stats()`** — rewritten to `SELECT ... FROM system_health_snapshots ORDER BY snapshot_date DESC LIMIT 1`. Same JSON shape, plus `snapshot_date` and `updated_at` for staleness display.
3. **`get_growth_stats(days)`** — rewritten to read the last N snapshot rows and compute day-over-day diffs with `LAG`, matching the existing `GrowthMetric` shape.

Write path: one call per day, plus occasional manual clicks. Read path: indexed single-row lookup for stats, at most N rows for growth. Scaling problem goes away.

### Schema

No changes. `system_health_snapshots` already has every column needed:

```
snapshot_date DATE UNIQUE, total_ships, total_inventory, total_loadouts,
total_encounters, total_users, total_active_users, avg_ships_per_user,
avg_gear_per_user, created_at, updated_at
```

### Migration

Single file: `supabase/migrations/20260420000002_system_stats_snapshot_architecture.sql`

```sql
-- 1. The write path: compute live, upsert today's row
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
    -- Auth: allow when called by an admin OR by a privileged role (pg_cron)
    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin)
    THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Cheap approximate counts
    SELECT n_live_tup INTO v_total_ships      FROM pg_stat_user_tables WHERE relname = 'ships';
    SELECT n_live_tup INTO v_total_inventory  FROM pg_stat_user_tables WHERE relname = 'inventory_items';
    SELECT n_live_tup INTO v_total_loadouts   FROM pg_stat_user_tables WHERE relname = 'loadouts';
    SELECT n_live_tup INTO v_total_encounters FROM pg_stat_user_tables WHERE relname = 'encounter_notes';
    SELECT n_live_tup INTO v_total_users      FROM pg_stat_user_tables WHERE relname = 'users';

    -- Live aggregates (fast after autovacuum tuning on inventory_items)
    SELECT COUNT(DISTINCT user_id) INTO v_total_active_users FROM ships;

    SELECT COALESCE(AVG(c), 0) INTO v_avg_ships
    FROM (SELECT COUNT(*) c FROM ships GROUP BY user_id) s;

    SELECT COALESCE(AVG(c), 0) INTO v_avg_gear
    FROM (SELECT COUNT(*) c FROM inventory_items GROUP BY user_id) g;

    INSERT INTO public.system_health_snapshots AS s (
        snapshot_date, total_ships, total_inventory, total_loadouts, total_encounters,
        total_users, total_active_users, avg_ships_per_user, avg_gear_per_user
    ) VALUES (
        CURRENT_DATE, COALESCE(v_total_ships,0), COALESCE(v_total_inventory,0),
        COALESCE(v_total_loadouts,0), COALESCE(v_total_encounters,0),
        COALESCE(v_total_users,0), v_total_active_users,
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

-- 2. Read path: latest snapshot
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

-- 3. Read path: day-over-day diffs for growth
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
    SELECT snapshot_date                                                           AS date,
           GREATEST(total_ships     - COALESCE(prev_ships, total_ships), 0)        AS new_ships,
           GREATEST(total_inventory - COALESCE(prev_inventory, total_inventory),0) AS new_gear,
           GREATEST(total_loadouts  - COALESCE(prev_loadouts, total_loadouts), 0)  AS new_loadouts,
           GREATEST(total_users     - COALESCE(prev_users, total_users), 0)        AS new_users
    FROM windowed
    WHERE snapshot_date >= CURRENT_DATE - days_back
    ORDER BY snapshot_date ASC;
$$;

-- 4. Schedule daily refresh at 03:00 UTC
SELECT cron.schedule(
    'refresh-system-snapshot',
    '0 3 * * *',
    $$SELECT public.refresh_system_snapshot();$$
);

-- 5. Seed today's snapshot so admin panel has data immediately post-deploy
SELECT public.refresh_system_snapshot();
```

### Security model

- All three functions are `SECURITY DEFINER` with `search_path = 'public'` (consistent with existing admin RPCs).
- `refresh_system_snapshot` has an explicit admin check: it allows the call when either (a) the caller has no `auth.uid()` — pg_cron runs as a privileged DB role outside the Supabase auth context — or (b) the caller's `auth.uid()` maps to `users.is_admin = true`.
- `get_system_stats` and `get_growth_stats` remain read-only. Existing admin-panel gating continues to apply; no tightening needed.

### Edge cases

| Case | Behavior |
| --- | --- |
| Admin clicks "Refresh now" multiple times in a day | Upsert on `snapshot_date` updates today's row in place. No duplicate rows. `updated_at` advances. |
| pg_cron misses a day | Next day's `get_growth_stats` row spans two days of deltas. Acceptable. |
| First day after deploy (only seed row exists) | `LAG` returns NULL → `COALESCE(prev_*, total_*)` → delta = 0. No nulls or negatives returned. |
| Non-admin calls `refresh_system_snapshot` via RPC | Function raises `42501 forbidden`. |
| `inventory_items` has a churn spike between cron runs | Snapshot values are slightly stale but the admin panel load remains instant. Admin can click "Refresh now" if they need current numbers. |

## Frontend changes

### `src/services/systemHealthService.ts`

- Extend `SystemStats`:
  ```ts
  export interface SystemStats {
      // existing fields...
      snapshot_date: string;
      updated_at: string;
  }
  ```
- Add:
  ```ts
  export async function refreshSystemSnapshot(): Promise<SystemStats | null> {
      const { data, error } = await supabase.rpc('refresh_system_snapshot');
      if (error) {
          console.error('Error refreshing system snapshot:', error);
          return null;
      }
      return data;
  }
  ```

### `src/pages/admin/AdminPanel.tsx` — Analytics tab only

- Add a `Button` (variant `secondary`, size `sm`) labelled "Refresh now" next to the section header for the system-stats cards.
- Handler: set a `refreshing` state to disable the button, call `refreshSystemSnapshot()`, on success `setSystemStats(returnedRow)` and show a success notification; on error show an error notification.
- Render muted "Last updated {relative time} ago" text (using `formatDistanceToNow` from `date-fns` — already a project dependency) near the stats cards using `systemStats.updated_at`.

No context changes, no storage-key changes, no new routes.

## Rollout

1. **Prerequisite PR:** VACUUM + autovacuum tuning on `inventory_items` (already scoped separately). Required so that the seed `SELECT refresh_system_snapshot()` at the end of the new migration runs cleanly without timing out.
2. **This PR:** migration + frontend changes. One atomic change.
3. **Post-deploy verification:**
   - `SELECT * FROM cron.job WHERE jobname = 'refresh-system-snapshot';` — confirms the schedule is registered.
   - `SELECT * FROM public.system_health_snapshots ORDER BY snapshot_date DESC LIMIT 1;` — confirms today's row was seeded.
   - Load the admin panel — confirm stats render instantly.
   - Click "Refresh now" — confirm `updated_at` advances and no duplicate row.
   - Day +1: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` — confirm the scheduled run succeeded.

## Testing

- **Automated:** none. The logic is plpgsql + SQL; unit-testing it without a real Postgres isn't valuable. The existing `__tests__/services/systemHealthService.test.ts` (if any) should be updated only to reflect the new `SystemStats` fields.
- **Manual:** covered by the rollout verification steps above.

## Out of scope

- Historical backfill of snapshot rows prior to today.
- Cron-failure alerting via `system_alerts`.
- Tuning the cron cadence below daily (YAGNI until there's evidence admins need sub-daily freshness without clicking the button).
- Deprecating any current live-compute fallback — there's no fallback needed; both the cron and the button write to the same row.
