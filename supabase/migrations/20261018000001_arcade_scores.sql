-- Arcade leaderboard: one best score per main account.
--
-- Scores are written only through submit_arcade_score, which keys the row on auth.uid() (the
-- main account; alt profiles never get a row) and keeps the higher score. Other players' rows
-- are read only through get_arcade_leaderboard, which exposes username and score and nothing
-- else. The score bound is a sanity check, not anti-cheat.
--
-- ON DELETE CASCADE: admin_delete_account deletes public.users rows; without the cascade a
-- player with a score could not be deleted.

CREATE TABLE public.arcade_scores (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  best_score integer NOT NULL CHECK (best_score BETWEEN 0 AND 10000000),
  best_credits integer NOT NULL DEFAULT 0 CHECK (best_credits >= 0),
  best_distance integer NOT NULL DEFAULT 0 CHECK (best_distance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX arcade_scores_best_score_idx ON public.arcade_scores (best_score DESC);

ALTER TABLE public.arcade_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own arcade score" ON public.arcade_scores
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own arcade score" ON public.arcade_scores
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own arcade score" ON public.arcade_scores
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own arcade score" ON public.arcade_scores
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.submit_arcade_score(
  p_score integer,
  p_credits integer,
  p_distance integer
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

  INSERT INTO public.arcade_scores AS a (user_id, best_score, best_credits, best_distance, updated_at)
  VALUES (uid, p_score, p_credits, p_distance, now())
  ON CONFLICT (user_id) DO UPDATE
    SET best_score = EXCLUDED.best_score,
        best_credits = EXCLUDED.best_credits,
        best_distance = EXCLUDED.best_distance,
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

CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (player_rank integer, username text, best_score integer, is_me boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT u.username,
           a.best_score,
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
     WHERE u.username IS NOT NULL
  )
  SELECT r.player_rank, r.username, r.best_score, coalesce(r.user_id = auth.uid(), false)
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.username;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.submit_arcade_score(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_arcade_score(integer, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;
