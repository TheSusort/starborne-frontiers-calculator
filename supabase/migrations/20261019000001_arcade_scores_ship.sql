-- Arcade leaderboard: the ship each best score was flown with.
--
-- best_ship is the template name of the fleet ship flown on the best-score run (NULL for the
-- neon fighter, and for rows saved before this column existed). Like best_credits and
-- best_distance it belongs to the best-score run: it changes only when the score improves.
-- The client resolves the portrait from the name (name -> ship template -> imageKey).
--
-- Compatibility with the deployed client (1.79), which calls
--   rpc('submit_arcade_score', { p_score, p_credits, p_distance })
-- and reads get_arcade_leaderboard rows field by field:
--   * submit_arcade_score gains p_ship text DEFAULT NULL. PostgREST resolves an RPC by the
--     argument NAMES it is sent and calls the function with named notation
--     (p_score := ..., p_credits := ..., p_distance := ...), so a call that omits a defaulted
--     parameter still matches the single 4-argument function and p_ship takes its default.
--     The old 3-argument function is dropped first: if both overloads existed, a 3-name call
--     would match both and PostgREST would reject it as ambiguous (PGRST203).
--   * get_arcade_leaderboard returns one more column, best_ship. The deployed parser
--     (parseLeaderboardRows) destructures the fields it knows and ignores the rest.
-- The drops and creates run in one transaction, so no request sees either function missing.
--
-- RLS, the score bound and the ranking are unchanged.

BEGIN;

ALTER TABLE public.arcade_scores
  ADD COLUMN best_ship text NULL
  CONSTRAINT arcade_scores_best_ship_length
    CHECK (best_ship IS NULL OR char_length(best_ship) BETWEEN 1 AND 64);

DROP FUNCTION public.submit_arcade_score(integer, integer, integer);

CREATE FUNCTION public.submit_arcade_score(
  p_score integer,
  p_credits integer,
  p_distance integer,
  p_ship text DEFAULT NULL
)
RETURNS TABLE (best integer, player_rank integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.arcade_scores AS a
    (user_id, best_score, best_credits, best_distance, best_ship, updated_at)
  VALUES (uid, p_score, p_credits, p_distance, p_ship, now())
  ON CONFLICT (user_id) DO UPDATE
    SET best_score = EXCLUDED.best_score,
        best_credits = EXCLUDED.best_credits,
        best_distance = EXCLUDED.best_distance,
        best_ship = EXCLUDED.best_ship,
        updated_at = now()
    WHERE EXCLUDED.best_score > a.best_score;

  -- Rank uses the leaderboard's definition: players with a username, ties share a rank.
  RETURN QUERY
  SELECT s.best_score,
         (SELECT count(*)::integer + 1
            FROM public.arcade_scores o
            JOIN public.users u ON u.id = o.user_id
           WHERE u.username IS NOT NULL AND o.best_score > s.best_score)
    FROM public.arcade_scores s
   WHERE s.user_id = uid;
END;
$$;

DROP FUNCTION public.get_arcade_leaderboard(integer);

CREATE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (player_rank integer, username text, best_score integer, is_me boolean, best_ship text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT u.username,
           a.best_score,
           a.best_ship,
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
     WHERE u.username IS NOT NULL
  )
  SELECT r.player_rank, r.username, r.best_score, coalesce(r.user_id = auth.uid(), false), r.best_ship
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.username;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.submit_arcade_score(integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_arcade_score(integer, integer, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
