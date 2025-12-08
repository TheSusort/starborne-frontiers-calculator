-- Update Engineering Leaderboard RPC Functions to include usernames
-- Run this in the Supabase SQL Editor after running add-user-profile-fields.sql

-- =============================================================================
-- FUNCTION 1: Engineering Points Leaderboard (Updated with usernames)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_engineering_leaderboard(current_user_id UUID)
RETURNS TABLE (
  rank BIGINT,
  total_points NUMERIC,
  is_current_user BOOLEAN,
  username TEXT
) AS $$
WITH user_totals AS (
  SELECT
    es.user_id,
    SUM(CASE WHEN es.type = 'flat' THEN es.value / 2.0 ELSE es.value END) as total_points
  FROM engineering_stats es
  GROUP BY es.user_id
  HAVING SUM(CASE WHEN es.type = 'flat' THEN es.value / 2.0 ELSE es.value END) > 0
),
ranked AS (
  SELECT
    ut.user_id,
    ut.total_points,
    ROW_NUMBER() OVER (ORDER BY ut.total_points DESC) as rank
  FROM user_totals ut
)
-- Top 10 + current user if outside top 10
SELECT
  r.rank,
  r.total_points,
  (r.user_id = current_user_id) as is_current_user,
  CASE
    WHEN u.is_public = true AND u.username IS NOT NULL THEN u.username
    ELSE NULL
  END as username
FROM ranked r
LEFT JOIN users u ON r.user_id = u.id
WHERE r.rank <= 10 OR r.user_id = current_user_id
ORDER BY r.rank;
$$ LANGUAGE sql SECURITY DEFINER;

-- =============================================================================
-- FUNCTION 2: Engineering Tokens Spent Leaderboard (Updated with usernames)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_engineering_tokens_leaderboard(current_user_id UUID)
RETURNS TABLE (
  rank BIGINT,
  total_tokens BIGINT,
  is_current_user BOOLEAN,
  username TEXT
) AS $$
WITH user_tokens AS (
  SELECT
    es.user_id,
    SUM(
      get_engineering_token_cost(
        CASE WHEN es.type = 'flat' THEN (es.value / 2)::INTEGER ELSE es.value::INTEGER END
      )
    ) as total_tokens
  FROM engineering_stats es
  GROUP BY es.user_id
  HAVING SUM(
    get_engineering_token_cost(
      CASE WHEN es.type = 'flat' THEN (es.value / 2)::INTEGER ELSE es.value::INTEGER END
    )
  ) > 0
),
ranked AS (
  SELECT
    ut.user_id,
    ut.total_tokens,
    ROW_NUMBER() OVER (ORDER BY ut.total_tokens DESC) as rank
  FROM user_tokens ut
)
-- Top 10 + current user if outside top 10
SELECT
  r.rank,
  r.total_tokens,
  (r.user_id = current_user_id) as is_current_user,
  CASE
    WHEN u.is_public = true AND u.username IS NOT NULL THEN u.username
    ELSE NULL
  END as username
FROM ranked r
LEFT JOIN users u ON r.user_id = u.id
WHERE r.rank <= 10 OR r.user_id = current_user_id
ORDER BY r.rank;
$$ LANGUAGE sql SECURITY DEFINER;

-- Grant execute permission to authenticated users (if not already granted)
GRANT EXECUTE ON FUNCTION get_engineering_leaderboard(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_engineering_tokens_leaderboard(UUID) TO authenticated;

