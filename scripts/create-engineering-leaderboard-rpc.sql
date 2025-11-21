-- Engineering Leaderboard RPC Functions
-- Run this in the Supabase SQL Editor to create the leaderboard functions

-- =============================================================================
-- FUNCTION 1: Engineering Points Leaderboard
-- =============================================================================
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

-- =============================================================================
-- FUNCTION 2: Engineering Tokens Spent Leaderboard
-- =============================================================================
-- Helper function to calculate cumulative token cost for a given level (1-20)
CREATE OR REPLACE FUNCTION get_engineering_token_cost(level INTEGER)
RETURNS INTEGER AS $$
DECLARE
  -- Cumulative costs to reach each level (index 0 = level 0 = 0 cost)
  -- Level 1: 100, Level 2: 250, Level 3: 450, etc.
  cumulative_costs INTEGER[] := ARRAY[
    0,      -- level 0 (no investment)
    100,    -- level 1
    250,    -- level 2
    450,    -- level 3
    700,    -- level 4
    1050,   -- level 5
    1500,   -- level 6
    2100,   -- level 7
    3000,   -- level 8
    4200,   -- level 9
    5900,   -- level 10
    8400,   -- level 11
    11600,  -- level 12
    16000,  -- level 13
    22000,  -- level 14
    30200,  -- level 15
    42200,  -- level 16
    57200,  -- level 17
    77200,  -- level 18
    107200, -- level 19
    147200  -- level 20
  ];
BEGIN
  IF level < 0 THEN
    RETURN 0;
  ELSIF level > 20 THEN
    RETURN cumulative_costs[21]; -- cap at level 20
  ELSE
    RETURN cumulative_costs[level + 1]; -- +1 because PostgreSQL arrays are 1-indexed
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Main function for tokens leaderboard
CREATE OR REPLACE FUNCTION get_engineering_tokens_leaderboard(current_user_id UUID)
RETURNS TABLE (
  rank BIGINT,
  total_tokens BIGINT,
  is_current_user BOOLEAN
) AS $$
WITH user_tokens AS (
  SELECT
    user_id,
    SUM(
      get_engineering_token_cost(
        CASE WHEN type = 'flat' THEN (value / 2)::INTEGER ELSE value::INTEGER END
      )
    ) as total_tokens
  FROM engineering_stats
  GROUP BY user_id
  HAVING SUM(
    get_engineering_token_cost(
      CASE WHEN type = 'flat' THEN (value / 2)::INTEGER ELSE value::INTEGER END
    )
  ) > 0
),
ranked AS (
  SELECT
    user_id,
    total_tokens,
    ROW_NUMBER() OVER (ORDER BY total_tokens DESC) as rank
  FROM user_tokens
)
-- Top 10 + current user if outside top 10
SELECT rank, total_tokens, (user_id = current_user_id) as is_current_user
FROM ranked
WHERE rank <= 10 OR user_id = current_user_id
ORDER BY rank;
$$ LANGUAGE sql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_engineering_token_cost(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_engineering_tokens_leaderboard(UUID) TO authenticated;
