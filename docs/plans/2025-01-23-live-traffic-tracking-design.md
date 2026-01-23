# Live Traffic Tracking Design

## Overview

Add real-time traffic tracking to the admin panel using a heartbeat system. This replaces the current RPC-based daily active user calculation with more accurate session-based tracking.

## Requirements

- Track live users (active in last 60 seconds)
- Track both authenticated and anonymous users
- Use session ID in localStorage for anonymous identification
- 30-second heartbeat interval
- 7-day data retention with daily aggregation
- Show top pages being viewed

## Database Schema

### New Table: `heartbeats`

```sql
CREATE TABLE public.heartbeats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,                    -- NULL for anonymous visitors
  page_path text NOT NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- Index for "active in last 60s" queries
CREATE INDEX heartbeats_created_at_idx ON public.heartbeats (created_at DESC);

-- Index for daily aggregation queries
CREATE INDEX heartbeats_session_user_idx ON public.heartbeats (session_id, user_id);
```

### RLS Policies

- Allow inserts from anyone (anon + authenticated)
- Only admins can read

## Client-Side Service

### `src/services/heartbeatService.ts`

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

export function startHeartbeat(userId: string | null) {
  if (intervalId) return; // Already running

  const sendHeartbeat = async () => {
    await supabase.from('heartbeats').insert({
      session_id: getSessionId(),
      user_id: userId,
      page_path: window.location.pathname,
    });
  };

  sendHeartbeat(); // Send immediately on start
  intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function updateHeartbeatUser(userId: string | null) {
  stopHeartbeat();
  startHeartbeat(userId);
}
```

### Integration

Call `startHeartbeat(user?.id)` from root `App` component. Update when auth state changes.

## Server-Side Functions

### Get Live Traffic

```sql
CREATE OR REPLACE FUNCTION get_live_traffic()
RETURNS TABLE (
  active_users bigint,
  active_sessions bigint,
  authenticated_users bigint,
  anonymous_sessions bigint,
  top_pages jsonb
) AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT DISTINCT ON (session_id)
      session_id, user_id, page_path
    FROM heartbeats
    WHERE created_at > now() - interval '60 seconds'
  )
  SELECT
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
    COUNT(DISTINCT session_id),
    COUNT(*) FILTER (WHERE user_id IS NOT NULL),
    COUNT(*) FILTER (WHERE user_id IS NULL),
    (SELECT jsonb_agg(jsonb_build_object('path', page_path, 'count', cnt))
     FROM (SELECT page_path, COUNT(*) as cnt FROM recent GROUP BY page_path ORDER BY cnt DESC LIMIT 5) t
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Get Daily Active Users

```sql
CREATE OR REPLACE FUNCTION get_daily_active_users(for_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  unique_sessions bigint,
  unique_users bigint,
  total_heartbeats bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT session_id),
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
    COUNT(*)
  FROM heartbeats
  WHERE created_at::date = for_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Aggregation & Cleanup (Daily Cron)

```sql
CREATE OR REPLACE FUNCTION aggregate_and_cleanup_heartbeats()
RETURNS void AS $$
DECLARE
  yesterday date := CURRENT_DATE - interval '1 day';
BEGIN
  -- Update daily_usage_stats with yesterday's heartbeat data
  INSERT INTO daily_usage_stats (date, unique_active_users, created_at, updated_at)
  SELECT
    yesterday,
    COUNT(DISTINCT COALESCE(user_id::text, session_id)),
    now(),
    now()
  FROM heartbeats
  WHERE created_at::date = yesterday
  ON CONFLICT (date) DO UPDATE SET
    unique_active_users = EXCLUDED.unique_active_users,
    updated_at = now();

  -- Delete heartbeats older than 7 days
  DELETE FROM heartbeats
  WHERE created_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule to run daily at 1 AM UTC
SELECT cron.schedule('aggregate-heartbeats', '0 1 * * *', 'SELECT aggregate_and_cleanup_heartbeats()');
```

## Admin UI Component

### `src/components/admin/LiveTrafficCard.tsx`

```typescript
interface LiveTraffic {
  active_sessions: number;
  authenticated_users: number;
  anonymous_sessions: number;
  top_pages: { path: string; count: number }[];
}

function LiveTrafficCard() {
  const [traffic, setTraffic] = useState<LiveTraffic | null>(null);

  useEffect(() => {
    const fetchTraffic = async () => {
      const { data } = await supabase.rpc('get_live_traffic');
      if (data?.[0]) setTraffic(data[0]);
    };

    fetchTraffic();
    const interval = setInterval(fetchTraffic, 10_000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-3">Live Traffic</h3>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Stat label="Active Now" value={traffic?.active_sessions ?? 0} />
        <Stat label="Logged In" value={traffic?.authenticated_users ?? 0} />
        <Stat label="Anonymous" value={traffic?.anonymous_sessions ?? 0} />
      </div>
      <div>
        <h4 className="text-sm text-gray-400 mb-2">Top Pages</h4>
        {traffic?.top_pages?.map(p => (
          <div key={p.path} className="flex justify-between text-sm">
            <span>{p.path}</span>
            <span>{p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Placement:** Add to Analytics tab in admin panel, at the top.

## Implementation Steps

1. Create `heartbeats` table with indexes and RLS policies
2. Create `get_live_traffic` RPC function
3. Create `get_daily_active_users` RPC function
4. Create `aggregate_and_cleanup_heartbeats` function and schedule cron
5. Create `heartbeatService.ts` client service
6. Integrate heartbeat service into App component
7. Create `LiveTrafficCard.tsx` component
8. Add LiveTrafficCard to admin Analytics tab
9. Update adminService.ts with new RPC calls

## Data Flow

```
User visits site
    ↓
startHeartbeat() called (immediately + every 30s)
    ↓
INSERT into heartbeats table
    ↓
Admin panel polls get_live_traffic() every 10s
    ↓
Daily cron aggregates into daily_usage_stats, deletes old data
```
