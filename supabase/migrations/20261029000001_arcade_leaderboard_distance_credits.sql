-- Arcade leaderboard: the distance and credits of each pilot's best-score run.
--
-- best_distance and best_credits already exist on arcade_scores and, like best_ship, belong to
-- the best-score run. get_arcade_leaderboard now returns them as two more columns. A function's
-- return type cannot change through CREATE OR REPLACE, so the function is dropped and created in
-- one transaction; no request sees it missing.
--
-- Compatibility in both deploy orders:
--   * Deployed client + migrated database: parseLeaderboardRows destructures the fields it
--     knows and ignores the rest.
--   * New client + unmigrated database: the two fields are absent, the parser yields null and the
--     page hides them.
--
-- Ranking, filters, the p_limit clamp and the grants are unchanged. submit_arcade_score is
-- untouched.

BEGIN;

DROP FUNCTION public.get_arcade_leaderboard(integer);

CREATE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (
  player_rank integer,
  username text,
  best_score integer,
  is_me boolean,
  best_ship text,
  is_guest boolean,
  best_distance integer,
  best_credits integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT coalesce(u.username, g.name) AS display_name,
           (u.username IS NULL AND g.user_id IS NOT NULL) AS guest,
           a.best_score,
           a.best_ship,
           a.best_distance,
           a.best_credits,
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
      LEFT JOIN public.arcade_guest_names g ON g.user_id = a.user_id
     WHERE coalesce(u.username, g.name) IS NOT NULL
  )
  SELECT r.player_rank, r.display_name, r.best_score,
         coalesce(r.user_id = auth.uid(), false), r.best_ship, r.guest,
         r.best_distance, r.best_credits
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.display_name;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
