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
