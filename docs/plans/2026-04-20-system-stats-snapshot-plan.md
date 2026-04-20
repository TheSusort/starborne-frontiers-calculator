# System Stats Snapshot Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `get_system_stats` and `get_growth_stats` off live aggregates onto the existing `system_health_snapshots` table, populated by a daily `pg_cron` job and an on-demand "Refresh now" admin button. Admin panel loads instantly; scaling problem gone.

**Architecture:** A single `refresh_system_snapshot()` plpgsql function owns the expensive live computation and upserts today's row into `system_health_snapshots`. Both `pg_cron` (daily at 03:00 UTC) and an admin-facing RPC call it. `get_system_stats()` now returns the latest snapshot row; `get_growth_stats()` windows over the last N rows with `LAG` for day-over-day diffs. Client-visible JSON shape is preserved (plus new optional `snapshot_date` / `updated_at` fields for staleness display).

**Tech Stack:** Supabase (Postgres 15, pg_cron), React 18, TypeScript, Vite, Vitest, TailwindCSS.

**Spec:** `docs/plans/2026-04-20-system-stats-snapshot-design.md`

**Prerequisite:** The VACUUM + autovacuum hotfix migration for `inventory_items` must already be deployed. The seed call at the end of Task 1's migration runs the same expensive live compute once and relies on the hotfix's fast-path to complete within the statement timeout.

---

## File Structure

**Create:**
- `supabase/migrations/20260420000002_system_stats_snapshot_architecture.sql` — the full migration: three functions, the cron schedule, and a seed call.
- `src/__tests__/services/systemHealthService.test.ts` — new test file covering the new `refreshSystemSnapshot` function and the extended `SystemStats` shape (none currently exists).

**Modify:**
- `src/services/systemHealthService.ts` — extend `SystemStats`, add `refreshSystemSnapshot`.
- `src/pages/admin/AdminPanel.tsx` — add "Refresh now" button and "Last updated" label in the System Health tab.

**Out of scope for this plan (handled separately / intentionally left out):**
- `supabase/current-schema.sql` — the header says "for context only, not meant to be run"; it's informational and typically regenerated. No change.
- Historical backfill, cron failure alerting, sub-daily cadence — explicitly deferred per the spec.

---

## Task 1: Create the migration

**Files:**
- Create: `supabase/migrations/20260420000002_system_stats_snapshot_architecture.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260420000002_system_stats_snapshot_architecture.sql` with exactly this content:

```sql
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
```

The `cron.unschedule` guard makes the migration safe to re-run locally against a DB that already has the job registered.

- [ ] **Step 2: Commit the migration**

```bash
git add supabase/migrations/20260420000002_system_stats_snapshot_architecture.sql
git commit -m "feat(db): snapshot-backed get_system_stats and get_growth_stats"
```

---

## Task 2: Verify the migration against a real database

Migrations here aren't unit-testable; we verify them by applying to a Supabase branch or staging project and running a short SQL-level acceptance suite.

**Files:** none modified — SQL verification only.

- [ ] **Step 1: Apply the migration**

Apply against a Supabase branch (or staging project). Either via `supabase db push` if the CLI is linked, or by pasting the migration file into the Supabase SQL editor and running it.

Expected: migration completes without error. The final `SELECT public.refresh_system_snapshot();` returns one row.

- [ ] **Step 2: Confirm the cron job is registered**

Run in the SQL editor:

```sql
SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'refresh-system-snapshot';
```

Expected: exactly one row, `schedule = '0 3 * * *'`, `active = true`.

- [ ] **Step 3: Confirm today's snapshot exists**

```sql
SELECT * FROM public.system_health_snapshots
ORDER BY snapshot_date DESC LIMIT 1;
```

Expected: one row with `snapshot_date = CURRENT_DATE` and non-zero totals matching current table sizes.

- [ ] **Step 4: Exercise the read path**

```sql
SELECT public.get_system_stats();
SELECT * FROM public.get_growth_stats(7);
```

Expected:
- `get_system_stats()` returns JSON with `snapshot_date` and `updated_at` populated.
- `get_growth_stats(7)` returns at least one row (today), all `new_*` columns `>= 0` and non-null.

- [ ] **Step 5: Exercise the upsert behaviour**

```sql
SELECT public.refresh_system_snapshot();
SELECT snapshot_date, updated_at FROM public.system_health_snapshots
WHERE snapshot_date = CURRENT_DATE;
SELECT COUNT(*) FROM public.system_health_snapshots
WHERE snapshot_date = CURRENT_DATE;
```

Expected: `updated_at` is fresher than before, `COUNT(*) = 1` (no duplicate row).

- [ ] **Step 6: Exercise the permission check**

Simulate a non-admin call in the SQL editor:

```sql
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000000';
SELECT public.refresh_system_snapshot();
RESET role;
```

Expected: `ERROR: forbidden` with `SQLSTATE 42501`. Reset role afterwards.

(If setting the JWT claim in-editor is awkward in your environment, skip to Task 5's end-to-end UI check — the same code path is exercised when a non-admin browser client hits the RPC and is rejected.)

- [ ] **Step 7: No commit**

This task modifies no tracked files. Record the observed outputs in the PR description when it's time.

---

## Task 3: Extend `systemHealthService.ts` (TDD)

**Files:**
- Modify: `src/services/systemHealthService.ts`
- Create: `src/__tests__/services/systemHealthService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/services/systemHealthService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// eslint-disable-next-line import/order
import {
    getSystemStats,
    refreshSystemSnapshot,
} from '../../services/systemHealthService';

vi.mock('../../config/supabase', () => ({
    supabase: {
        rpc: vi.fn(),
    },
}));

import { supabase } from '../../config/supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
});

const sampleStats = {
    total_ships: 11168,
    total_inventory: 503909,
    total_loadouts: 17,
    total_encounters: 53,
    total_users: 85,
    total_active_users: 72,
    avg_ships_per_user: 155.1,
    avg_gear_per_user: 6998.7,
    snapshot_date: '2026-04-20',
    updated_at: '2026-04-20T10:15:00.000Z',
};

describe('getSystemStats', () => {
    it('calls the get_system_stats RPC and returns the row', async () => {
        mockRpc.mockResolvedValue({ data: sampleStats, error: null });

        const result = await getSystemStats();

        expect(mockRpc).toHaveBeenCalledWith('get_system_stats');
        expect(result).toEqual(sampleStats);
    });

    it('returns null on RPC error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

        const result = await getSystemStats();

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

describe('refreshSystemSnapshot', () => {
    it('calls the refresh_system_snapshot RPC and returns the row', async () => {
        mockRpc.mockResolvedValue({ data: sampleStats, error: null });

        const result = await refreshSystemSnapshot();

        expect(mockRpc).toHaveBeenCalledWith('refresh_system_snapshot');
        expect(result).toEqual(sampleStats);
    });

    it('returns null on RPC error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });

        const result = await refreshSystemSnapshot();

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
```

- [ ] **Step 2: Run the tests — they should fail**

Run: `npm test -- src/__tests__/services/systemHealthService.test.ts`
Expected: compile error / import failure because `refreshSystemSnapshot` is not exported, and / or the `SystemStats` shape is missing `snapshot_date` / `updated_at`.

- [ ] **Step 3: Implement the service changes**

Modify `src/services/systemHealthService.ts`:

1. Extend the `SystemStats` interface to include the two new fields:

```ts
export interface SystemStats {
    total_ships: number;
    total_inventory: number;
    total_loadouts: number;
    total_encounters: number;
    total_users: number;
    total_active_users: number;
    avg_ships_per_user: number;
    avg_gear_per_user: number;
    snapshot_date: string;
    updated_at: string;
}
```

2. Add a new export immediately after `getSystemStats`:

```ts
/**
 * Recompute and upsert today's system-health snapshot, returning the new row.
 * Admin-only; non-admin callers receive a 42501 error from the RPC.
 */
export async function refreshSystemSnapshot(): Promise<SystemStats | null> {
    try {
        const { data, error } = await supabase.rpc('refresh_system_snapshot');

        if (error) {
            console.error('Error refreshing system snapshot:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error refreshing system snapshot:', error);
        return null;
    }
}
```

- [ ] **Step 4: Run the tests — they should pass**

Run: `npm test -- src/__tests__/services/systemHealthService.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Run lint + full test suite**

```bash
npm run lint
npm test
```

Expected: no new warnings, no failing tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/systemHealthService.ts src/__tests__/services/systemHealthService.test.ts
git commit -m "feat(admin): refreshSystemSnapshot service + snapshot_date/updated_at on SystemStats"
```

---

## Task 4: Wire up the admin UI

**Files:**
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Add the refresh handler + relative-time helper**

In `src/pages/admin/AdminPanel.tsx`:

1. Update the import from `systemHealthService` to include `refreshSystemSnapshot`:

```ts
import {
    getSystemStats,
    getGrowthStats,
    getTableSizes,
    refreshSystemSnapshot,
    SystemStats,
    GrowthMetric,
    TableInfo,
} from '../../services/systemHealthService';
```

2. Near the top of the `AdminPanel` component (alongside the other `useState` calls), add the refreshing state:

```ts
const [refreshingSystemStats, setRefreshingSystemStats] = useState(false);
```

3. Above the `useEffect` at line ~198, add the handler and a small relative-time helper (the project has no date library; this avoids pulling one in for a single label):

```ts
const handleRefreshSystemStats = async () => {
    setRefreshingSystemStats(true);
    const fresh = await refreshSystemSnapshot();
    if (fresh) {
        setSystemStats(fresh);
        addNotification('success', 'System stats refreshed');
    } else {
        addNotification('error', 'Failed to refresh system stats');
    }
    setRefreshingSystemStats(false);
};

const formatRelativeTime = (iso: string): string => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};
```

- [ ] **Step 2: Render the header row + last-updated label**

In the System Health tab JSX (currently starts at around line 413 with `{activeTab === 'system-health' && (`), insert a header row as the first child of the `<div className="space-y-6">` block, before the existing `{systemStats && ...}` stat cards:

```tsx
<div className="flex items-center justify-between gap-4">
    <div>
        <h3 className="text-lg font-semibold">System Stats</h3>
        {systemStats?.updated_at && (
            <p className="text-sm text-gray-400">
                Last updated {formatRelativeTime(systemStats.updated_at)}
            </p>
        )}
    </div>
    <Button
        variant="secondary"
        size="sm"
        onClick={() => void handleRefreshSystemStats()}
        disabled={refreshingSystemStats}
    >
        {refreshingSystemStats ? 'Refreshing…' : 'Refresh now'}
    </Button>
</div>
```

Leave the existing `{systemStats && ...}` stat-card grid and the average-stats grid exactly as they are — they render below the new header.

- [ ] **Step 3: Run type check + lint**

```bash
npm run lint
```

Expected: no new warnings. (TypeScript errors would surface as lint errors via the project's setup.)

- [ ] **Step 4: Manual browser check**

Start the dev server, sign in as an admin, navigate to Admin Panel → System Health tab. Confirm:

1. System stats cards render immediately (no timeout).
2. The "Last updated …" label shows a small value (seconds / minutes ago).
3. Clicking "Refresh now" disables the button, updates the stats, updates the label, and shows a success notification.
4. Console is free of errors.

Run: `npm start` (if not already running).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/AdminPanel.tsx
git commit -m "feat(admin): Refresh now button and last-updated label for system stats"
```

---

## Task 5: End-to-end verification

**Files:** none modified.

- [ ] **Step 1: Confirm read path is snapshot-driven**

In the Supabase SQL editor:

```sql
EXPLAIN ANALYZE SELECT public.get_system_stats();
```

Expected: plan scans `system_health_snapshots` via an index / seq scan over a handful of rows; execution time < 50 ms.

- [ ] **Step 2: Confirm the admin panel loads cleanly against the new path**

Open the deployed (or staging) admin panel → System Health tab. Confirm no 500 errors in the browser console, cards populate instantly.

- [ ] **Step 3: Confirm cron job runs the next morning**

The morning after deploy (or after the first `03:00 UTC` firing), run:

```sql
SELECT jobid, jobname, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh-system-snapshot')
ORDER BY start_time DESC
LIMIT 3;
```

Expected: the most recent run has `status = 'succeeded'` and a new row exists in `system_health_snapshots` for that date.

- [ ] **Step 4: Write the PR description**

Include:
- Link to spec (`docs/plans/2026-04-20-system-stats-snapshot-design.md`).
- SQL outputs from Task 2 steps 2–5 and Task 5 step 1 (timings and row counts).
- A note that the VACUUM + autovacuum hotfix is a prerequisite PR and must land first.

---

## Rollback plan

If anything regresses after deploy:

1. In the Supabase SQL editor, run:

```sql
SELECT cron.unschedule('refresh-system-snapshot');
```

2. Restore the previous `get_system_stats` and `get_growth_stats` function bodies from the pre-migration backup (or from `pg_get_functiondef` output captured pre-deploy).

3. The `system_health_snapshots` table rows and the new `refresh_system_snapshot` function are harmless if left in place — no cleanup required.

---

## Definition of done

- Migration applied on production, cron job registered, today's snapshot row present.
- Admin panel System Health tab loads without 500s, "Refresh now" works, "Last updated" label renders.
- `EXPLAIN ANALYZE get_system_stats()` < 50 ms.
- Next-day `cron.job_run_details` shows a succeeded run for `refresh-system-snapshot`.
- All existing Vitest tests still pass; the 4 new tests for `systemHealthService` pass.
