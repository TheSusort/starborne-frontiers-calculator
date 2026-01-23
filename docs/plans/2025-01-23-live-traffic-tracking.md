# Live Traffic Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time traffic tracking to the admin panel using a heartbeat system that tracks both authenticated and anonymous users.

**Architecture:** Client sends heartbeats every 30 seconds to a `heartbeats` table. Admin panel queries for sessions active in last 60 seconds. Daily cron aggregates data into `daily_usage_stats` and cleans up records older than 7 days.

**Tech Stack:** Supabase (PostgreSQL, RLS, pg_cron), React, TypeScript

---

## Task 1: Create Heartbeats Table

**Files:**
- Create: `supabase/migrations/20250123000001_create_heartbeats_table.sql`

**Step 1: Write the migration SQL**

```sql
-- Create heartbeats table for live traffic tracking
CREATE TABLE public.heartbeats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  page_path text NOT NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for "active in last 60s" queries
CREATE INDEX heartbeats_created_at_idx ON public.heartbeats (created_at DESC);

-- Index for daily aggregation queries
CREATE INDEX heartbeats_session_user_idx ON public.heartbeats (session_id, user_id);

-- Enable RLS
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert heartbeats (both anon and authenticated)
CREATE POLICY "Anyone can insert heartbeats"
  ON public.heartbeats
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read heartbeats
CREATE POLICY "Admins can read heartbeats"
  ON public.heartbeats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );
```

**Step 2: Run migration in Supabase**

Run the SQL in Supabase SQL Editor or via CLI.

**Step 3: Commit**

```bash
git add supabase/migrations/20250123000001_create_heartbeats_table.sql
git commit -m "feat(db): add heartbeats table for live traffic tracking"
```

---

## Task 2: Create get_live_traffic RPC Function

**Files:**
- Create: `supabase/migrations/20250123000002_create_live_traffic_rpc.sql`

**Step 1: Write the RPC function**

```sql
-- Function to get live traffic stats (users active in last 60 seconds)
CREATE OR REPLACE FUNCTION get_live_traffic()
RETURNS TABLE (
  active_sessions bigint,
  authenticated_users bigint,
  anonymous_sessions bigint,
  top_pages jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      user_id,
      page_path
    FROM heartbeats
    WHERE created_at > now() - interval '60 seconds'
    ORDER BY session_id, created_at DESC
  )
  SELECT
    COUNT(DISTINCT r.session_id)::bigint AS active_sessions,
    COUNT(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL)::bigint AS authenticated_users,
    COUNT(*) FILTER (WHERE r.user_id IS NULL)::bigint AS anonymous_sessions,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('path', t.page_path, 'count', t.cnt))
       FROM (
         SELECT page_path, COUNT(*) as cnt
         FROM recent
         GROUP BY page_path
         ORDER BY cnt DESC
         LIMIT 5
       ) t),
      '[]'::jsonb
    ) AS top_pages
  FROM recent r;
END;
$$;

-- Grant execute to authenticated users (admin check happens in RLS)
GRANT EXECUTE ON FUNCTION get_live_traffic() TO authenticated;
```

**Step 2: Run migration in Supabase**

Run the SQL in Supabase SQL Editor.

**Step 3: Commit**

```bash
git add supabase/migrations/20250123000002_create_live_traffic_rpc.sql
git commit -m "feat(db): add get_live_traffic RPC function"
```

---

## Task 3: Create Aggregation and Cleanup Function

**Files:**
- Create: `supabase/migrations/20250123000003_create_heartbeat_aggregation.sql`

**Step 1: Write the aggregation function and cron job**

```sql
-- Function to aggregate yesterday's heartbeats and cleanup old data
CREATE OR REPLACE FUNCTION aggregate_and_cleanup_heartbeats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  yesterday date := CURRENT_DATE - interval '1 day';
  session_count bigint;
BEGIN
  -- Count unique sessions from yesterday
  SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id))
  INTO session_count
  FROM heartbeats
  WHERE created_at::date = yesterday;

  -- Update daily_usage_stats with yesterday's heartbeat data
  INSERT INTO daily_usage_stats (date, unique_active_users, created_at, updated_at)
  VALUES (yesterday, session_count, now(), now())
  ON CONFLICT (date) DO UPDATE SET
    unique_active_users = EXCLUDED.unique_active_users,
    updated_at = now();

  -- Delete heartbeats older than 7 days
  DELETE FROM heartbeats
  WHERE created_at < now() - interval '7 days';
END;
$$;

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule to run daily at 1 AM UTC
SELECT cron.schedule(
  'aggregate-heartbeats',
  '0 1 * * *',
  'SELECT aggregate_and_cleanup_heartbeats()'
);
```

**Step 2: Run migration in Supabase**

Run the SQL in Supabase SQL Editor. Note: pg_cron must be enabled in your Supabase project settings.

**Step 3: Commit**

```bash
git add supabase/migrations/20250123000003_create_heartbeat_aggregation.sql
git commit -m "feat(db): add heartbeat aggregation cron job"
```

---

## Task 4: Create Heartbeat Service

**Files:**
- Create: `src/services/heartbeatService.ts`

**Step 1: Create the heartbeat service**

```typescript
import { supabase } from '../config/supabase';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const SESSION_ID_KEY = 'heartbeat_session_id';

function getSessionId(): string {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
}

let intervalId: number | null = null;
let currentUserId: string | null = null;

async function sendHeartbeat(): Promise<void> {
    try {
        await supabase.from('heartbeats').insert({
            session_id: getSessionId(),
            user_id: currentUserId,
            page_path: window.location.pathname,
        });
    } catch (error) {
        // Silently fail - heartbeats are non-critical
        console.debug('Heartbeat failed:', error);
    }
}

export function startHeartbeat(userId: string | null): void {
    if (intervalId !== null) {
        // Already running, just update the user ID
        currentUserId = userId;
        return;
    }

    currentUserId = userId;

    // Send immediately on start
    sendHeartbeat();

    // Then send every 30 seconds
    intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat(): void {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
    currentUserId = null;
}

export function updateHeartbeatUser(userId: string | null): void {
    currentUserId = userId;
}
```

**Step 2: Commit**

```bash
git add src/services/heartbeatService.ts
git commit -m "feat: add heartbeat service for live traffic tracking"
```

---

## Task 5: Integrate Heartbeat into App

**Files:**
- Modify: `src/App.tsx`

**Step 1: Import and start heartbeat service**

Add import at top of file (after other imports around line 17):

```typescript
import { startHeartbeat, updateHeartbeatUser } from './services/heartbeatService';
```

**Step 2: Start heartbeat on mount**

Add a new `useEffect` inside the `App` component, after the existing changelog `useEffect` (after line 76):

```typescript
    // Start heartbeat for live traffic tracking
    useEffect(() => {
        startHeartbeat(null); // Start with no user
    }, []);
```

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate heartbeat service into App"
```

---

## Task 6: Update Heartbeat User on Auth Change

**Files:**
- Modify: `src/contexts/AuthProvider.tsx`

**Step 1: Import heartbeat service**

Add import at top of file (after line 7):

```typescript
import { updateHeartbeatUser } from '../services/heartbeatService';
```

**Step 2: Update heartbeat user on auth state change**

In the `onAuthStateChanged` callback (around line 55), after `setCurrentUser(user);`, add:

```typescript
            // Update heartbeat tracking with user ID
            updateHeartbeatUser(user?.id ?? null);
```

**Step 3: Commit**

```bash
git add src/contexts/AuthProvider.tsx
git commit -m "feat: update heartbeat user on auth state change"
```

---

## Task 7: Add Live Traffic Types to Admin Service

**Files:**
- Modify: `src/services/adminService.ts`

**Step 1: Add LiveTraffic interface**

Add after the `TopUser` interface (around line 17):

```typescript
export interface LiveTraffic {
    active_sessions: number;
    authenticated_users: number;
    anonymous_sessions: number;
    top_pages: { path: string; count: number }[];
}
```

**Step 2: Add getLiveTraffic function**

Add after the `getTotalUserCount` function (around line 120):

```typescript
/**
 * Get live traffic stats (users active in last 60 seconds)
 */
export async function getLiveTraffic(): Promise<LiveTraffic | null> {
    try {
        const { data, error } = await supabase.rpc('get_live_traffic');

        if (error) {
            console.error('Error fetching live traffic:', error);
            return null;
        }

        // RPC returns an array with one row
        if (data && data.length > 0) {
            return data[0];
        }

        return {
            active_sessions: 0,
            authenticated_users: 0,
            anonymous_sessions: 0,
            top_pages: [],
        };
    } catch (error) {
        console.error('Error fetching live traffic:', error);
        return null;
    }
}
```

**Step 3: Commit**

```bash
git add src/services/adminService.ts
git commit -m "feat: add getLiveTraffic function to admin service"
```

---

## Task 8: Create LiveTrafficCard Component

**Files:**
- Create: `src/components/admin/LiveTrafficCard.tsx`

**Step 1: Create the component**

```typescript
import React, { useEffect, useState } from 'react';
import { getLiveTraffic, LiveTraffic } from '../../services/adminService';
import { StatCard } from '../ui/StatCard';

const REFRESH_INTERVAL = 10_000; // 10 seconds

export const LiveTrafficCard: React.FC = () => {
    const [traffic, setTraffic] = useState<LiveTraffic | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTraffic = async () => {
            const data = await getLiveTraffic();
            setTraffic(data);
            setLoading(false);
        };

        fetchTraffic();
        const interval = setInterval(fetchTraffic, REFRESH_INTERVAL);

        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="card animate-pulse">
                <div className="h-32 bg-gray-700 rounded"></div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Live Traffic</h3>
                <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span className="text-xs text-gray-400">Live</span>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                    <div className="text-2xl font-bold text-white">
                        {traffic?.active_sessions ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Active Now</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                        {traffic?.authenticated_users ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Logged In</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-gray-400">
                        {traffic?.anonymous_sessions ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Anonymous</div>
                </div>
            </div>

            {traffic?.top_pages && traffic.top_pages.length > 0 && (
                <div>
                    <h4 className="text-sm text-gray-400 mb-2">Top Pages</h4>
                    <div className="space-y-1">
                        {traffic.top_pages.map((page) => (
                            <div
                                key={page.path}
                                className="flex justify-between text-sm"
                            >
                                <span className="text-gray-300 truncate max-w-[200px]">
                                    {page.path}
                                </span>
                                <span className="text-gray-500">{page.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
```

**Step 2: Commit**

```bash
git add src/components/admin/LiveTrafficCard.tsx
git commit -m "feat: add LiveTrafficCard component for admin panel"
```

---

## Task 9: Add LiveTrafficCard to Admin Panel

**Files:**
- Modify: `src/pages/admin/AdminPanel.tsx`

**Step 1: Import LiveTrafficCard**

Add import after line 12 (after TemplateProposalsTable import):

```typescript
import { LiveTrafficCard } from '../../components/admin/LiveTrafficCard';
```

**Step 2: Add LiveTrafficCard to Analytics tab**

Find the Analytics tab section (around line 217-244). Add LiveTrafficCard as the first item, before the Summary Stats grid:

Replace:
```typescript
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Summary Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
```

With:
```typescript
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Live Traffic */}
                        <LiveTrafficCard />

                        {/* Summary Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
```

**Step 3: Commit**

```bash
git add src/pages/admin/AdminPanel.tsx
git commit -m "feat: add live traffic card to admin analytics tab"
```

---

## Task 10: Update current-schema.sql Reference

**Files:**
- Modify: `supabase/current-schema.sql`

**Step 1: Add heartbeats table to schema reference**

Add after the `engineering_stats` table definition (around line 85):

```sql
CREATE TABLE public.heartbeats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  page_path text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
```

**Step 2: Commit**

```bash
git add supabase/current-schema.sql
git commit -m "docs: add heartbeats table to schema reference"
```

---

## Final Verification

After completing all tasks:

1. **Test heartbeat service**: Open browser DevTools Network tab, filter by "heartbeats", verify requests are sent every 30 seconds
2. **Test admin panel**: Navigate to /admin, verify Live Traffic card shows data
3. **Test anonymous tracking**: Open incognito window, verify heartbeats are sent without user_id
4. **Verify RLS**: Attempt to read heartbeats as non-admin user, should fail

Run lint to ensure no issues:
```bash
npm run lint
```

Create final commit if any fixes needed:
```bash
git add -A
git commit -m "fix: address any linting issues"
```
