-- Engineering Leaderboard RPC Function
-- Run this in the Supabase SQL Editor to create the leaderboard function

CREATE OR REPLACE FUNCTION get_engineering_leaderboard(current_user_id UUID)
RETURNS TABLE (
  rank BIGINT,
  total_points NUMERIC,
  is_current_user BOOLEAN
) AS $$
WITH user_totals AS (
  SELECT
    user_id,
    SUM(CASE WHEN type = 'flat' THEN value / 2.0 ELSE value END) as total_points
  FROM engineering_stats
  GROUP BY user_id
  HAVING SUM(CASE WHEN type = 'flat' THEN value / 2.0 ELSE value END) > 0
),
ranked AS (
  SELECT
    user_id,
    total_points,
    ROW_NUMBER() OVER (ORDER BY total_points DESC) as rank
  FROM user_totals
)
-- Top 10 + current user if outside top 10
SELECT rank, total_points, (user_id = current_user_id) as is_current_user
FROM ranked
WHERE rank <= 10 OR user_id = current_user_id
ORDER BY rank;
$$ LANGUAGE sql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_engineering_leaderboard(UUID) TO authenticated;
