-- Ship Rankings RPC Function
-- This function calculates top ship rankings for a user efficiently
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- FUNCTION: Get Top Ship Rankings for User
-- =============================================================================
-- This function returns the top 10 ships where the user ranks highest
-- It uses a simplified ranking based on ship level and rank (not full scoring)
CREATE OR REPLACE FUNCTION get_user_top_ship_rankings(current_user_id UUID)
RETURNS TABLE (
  ship_name TEXT,
  ship_type TEXT,
  estimated_rank BIGINT,
  total_entries BIGINT,
  user_ship_level INTEGER,
  user_ship_rank INTEGER
) AS $$
WITH user_ships AS (
  -- Get the user's BEST ship for each name (highest level, then highest rank)
  SELECT DISTINCT ON (name)
    name,
    type,
    level,
    rank
  FROM ships
  WHERE user_id = current_user_id
  ORDER BY name, level DESC, rank DESC
),
ship_counts AS (
  -- Get counts for all ship names that the user has
  SELECT 
    name,
    COUNT(*) as total_count
  FROM ships
  WHERE name IN (SELECT name FROM user_ships)
  GROUP BY name
),
all_ships_ranked AS (
  -- For each ship name, rank ALL ships by level DESC, rank DESC
  SELECT 
    s.name,
    s.level,
    s.rank,
    s.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.name 
      ORDER BY s.level DESC, s.rank DESC
    ) as ship_rank
  FROM ships s
  WHERE s.name IN (SELECT name FROM user_ships)
),
user_ship_ranks AS (
  -- Get the rank of the user's best ship for each name
  SELECT 
    us.name as ship_name,
    us.type as ship_type,
    sc.total_count as total_entries,
    us.level as user_ship_level,
    us.rank as user_ship_rank,
    asr.ship_rank as estimated_rank
  FROM user_ships us
  JOIN ship_counts sc ON us.name = sc.name
  JOIN all_ships_ranked asr ON 
    asr.name = us.name 
    AND asr.user_id = current_user_id
    AND asr.level = us.level
    AND asr.rank = us.rank
)
SELECT 
  ship_name,
  ship_type,
  estimated_rank,
  total_entries,
  user_ship_level,
  user_ship_rank
FROM user_ship_ranks
ORDER BY estimated_rank ASC
LIMIT 10;
$$ LANGUAGE sql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_top_ship_rankings(UUID) TO authenticated;

-- ROLLBACK (if needed):
-- DROP FUNCTION IF EXISTS get_user_top_ship_rankings(UUID);

