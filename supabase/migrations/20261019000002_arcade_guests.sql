-- Arcade guests: anyone can join the arcade leaderboard through Supabase anonymous sign-in.
--
-- A guest is an anonymous auth user. Guest-ness is read from the JWT claim (is_anonymous) and
-- from auth.users.is_anonymous; it is never stored. The insert_user trigger on auth.users, when
-- present, gives a guest a public.users row (email and username NULL); submit_arcade_score inserts
-- it if missing, so the foreign keys hold either way.
--
-- A guest's display name lives in arcade_guest_names, unique among guests (case-insensitive) and
-- separate from users.username, which stays reserved for accounts. The leaderboard shows
-- coalesce(username, guest name) and flags guest rows with is_guest.
--
-- Guests are shut out of user data: has_profile_access, the users self-update policy and the
-- alt-insert policy all reject an anonymous session. Tables whose write policies do not go through
-- has_profile_access carry RESTRICTIVE write policies that reject an anonymous session, so a guest
-- writes only through the SECURITY DEFINER arcade RPCs.
--
-- Compatibility with the deployed client:
--   * submit_arcade_score gains p_guest_name text DEFAULT NULL. The 4-argument function is dropped
--     first so a call sending 3 or 4 argument names matches exactly one function (PGRST203
--     otherwise); see 20261019000001_arcade_scores_ship.sql.
--   * get_arcade_leaderboard returns one more column, is_guest; the deployed parser ignores
--     fields it does not know.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_anonymous_session()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

GRANT EXECUTE ON FUNCTION public.is_anonymous_session() TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guest names
-- ---------------------------------------------------------------------------------------------

CREATE TABLE public.arcade_guest_names (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT arcade_guest_names_name_format
    CHECK (name ~ '^[a-zA-Z0-9 _-]{3,20}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX arcade_guest_names_name_lower_idx ON public.arcade_guest_names (lower(name));

ALTER TABLE public.arcade_guest_names ENABLE ROW LEVEL SECURITY;

-- Writes go through submit_arcade_score only; there are no INSERT/UPDATE/DELETE policies.
CREATE POLICY "Guests can read own arcade name" ON public.arcade_guest_names
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Shut guests out of user data
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_profile_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT public.is_anonymous_session()
     AND EXISTS (
       SELECT 1 FROM public.users
       WHERE id = target_user_id
         AND (id = auth.uid() OR owner_auth_user_id = auth.uid())
     );
$$;

DROP POLICY IF EXISTS "Users can update own profile or owned alts" ON public.users;
CREATE POLICY "Users can update own profile or owned alts" ON public.users
  FOR UPDATE TO authenticated
  USING ((auth.uid() = id OR owner_auth_user_id = auth.uid()) AND NOT public.is_anonymous_session())
  WITH CHECK ((auth.uid() = id OR owner_auth_user_id = auth.uid()) AND NOT public.is_anonymous_session());

DROP POLICY IF EXISTS "Users can insert alt profiles they own" ON public.users;
CREATE POLICY "Users can insert alt profiles they own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_auth_user_id = auth.uid()
    AND id != auth.uid()
    AND is_admin = false
    AND NOT public.is_anonymous_session()
  );

-- Restrictive policies AND with every permissive policy on the table, including live ones not in
-- this repo, so a guest cannot INSERT, UPDATE or DELETE these tables through the REST API whatever
-- the permissive policies say. Reads are untouched: a guest browses public data like anyone else.
-- Votes are one per auth user, and every anonymous sign-in is a new auth user, so guest votes
-- would be ballot-stuffing. arcade_scores is written by submit_arcade_score (SECURITY DEFINER,
-- which bypasses RLS), never directly.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'arcade_scores',
    'encounter_votes',
    'community_recommendation_votes',
    'community_recommendations',
    'encounter_notes',
    'encounter_formations',
    'ship_template_proposals',
    'ship_templates',
    'user_activity_log',
    'statistics_snapshots',
    'system_health_snapshots',
    'system_alerts'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "No guest inserts" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest inserts" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated '
      'WITH CHECK (NOT public.is_anonymous_session())', t);
    EXECUTE format('DROP POLICY IF EXISTS "No guest updates" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest updates" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated '
      'USING (NOT public.is_anonymous_session()) WITH CHECK (NOT public.is_anonymous_session())', t);
    EXECUTE format('DROP POLICY IF EXISTS "No guest deletes" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No guest deletes" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated '
      'USING (NOT public.is_anonymous_session())', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Leaderboard RPCs
-- ---------------------------------------------------------------------------------------------

DROP FUNCTION public.submit_arcade_score(integer, integer, integer, text);

CREATE FUNCTION public.submit_arcade_score(
  p_score integer,
  p_credits integer,
  p_distance integer,
  p_ship text DEFAULT NULL,
  p_guest_name text DEFAULT NULL
)
RETURNS TABLE (best integer, player_rank integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  guest boolean := public.is_anonymous_session();
  guest_name text := nullif(btrim(p_guest_name), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF guest THEN
    INSERT INTO public.users (id) VALUES (uid) ON CONFLICT (id) DO NOTHING;

    IF guest_name IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.arcade_guest_names
         WHERE lower(name) = lower(guest_name) AND user_id <> uid
      ) THEN
        RAISE EXCEPTION 'guest_name_taken' USING ERRCODE = '23505';
      END IF;
      -- A concurrent claim of the same name passes the check above and trips the lower(name)
      -- unique index here.
      BEGIN
        INSERT INTO public.arcade_guest_names (user_id, name)
        VALUES (uid, guest_name)
        ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'guest_name_taken' USING ERRCODE = '23505';
      END;
    ELSIF NOT EXISTS (SELECT 1 FROM public.arcade_guest_names WHERE user_id = uid) THEN
      RAISE EXCEPTION 'guest_name_required';
    END IF;
  ELSIF guest_name IS NOT NULL THEN
    RAISE EXCEPTION 'guest_name_for_account';
  END IF;

  INSERT INTO public.arcade_scores AS a
    (user_id, best_score, best_credits, best_distance, best_ship, updated_at)
  VALUES (uid, p_score, p_credits, p_distance, NULLIF(p_ship, ''), now())
  ON CONFLICT (user_id) DO UPDATE
    SET best_score = EXCLUDED.best_score,
        best_credits = EXCLUDED.best_credits,
        best_distance = EXCLUDED.best_distance,
        best_ship = EXCLUDED.best_ship,
        updated_at = now()
    WHERE EXCLUDED.best_score > a.best_score;

  -- Rank uses the leaderboard's definition: players with a display name, ties share a rank.
  RETURN QUERY
  SELECT s.best_score,
         (SELECT count(*)::integer + 1
            FROM public.arcade_scores o
            JOIN public.users u ON u.id = o.user_id
            LEFT JOIN public.arcade_guest_names g ON g.user_id = o.user_id
           WHERE coalesce(u.username, g.name) IS NOT NULL AND o.best_score > s.best_score)
    FROM public.arcade_scores s
   WHERE s.user_id = uid;
END;
$$;

DROP FUNCTION public.get_arcade_leaderboard(integer);

CREATE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (
  player_rank integer,
  username text,
  best_score integer,
  is_me boolean,
  best_ship text,
  is_guest boolean
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
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
      LEFT JOIN public.arcade_guest_names g ON g.user_id = a.user_id
     WHERE coalesce(u.username, g.name) IS NOT NULL
  )
  SELECT r.player_rank, r.display_name, r.best_score,
         coalesce(r.user_id = auth.uid(), false), r.best_ship, r.guest
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.display_name;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.submit_arcade_score(integer, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_arcade_score(integer, integer, integer, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------------------------

-- Deletes anonymous auth users whose best score has not improved in 90 days, and those more than
-- a day old that never claimed a name. handle_auth_user_delete and the FK cascades remove their
-- users, name and score rows. Scheduled with pg_cron outside this migration.
CREATE OR REPLACE FUNCTION public.cleanup_arcade_guests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM auth.users au
   WHERE au.is_anonymous
     AND (
       EXISTS (SELECT 1 FROM public.arcade_scores s
                WHERE s.user_id = au.id AND s.updated_at < now() - interval '90 days')
       OR (au.created_at < now() - interval '1 day'
           AND NOT EXISTS (SELECT 1 FROM public.arcade_guest_names g WHERE g.user_id = au.id))
     );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_arcade_guests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_arcade_guests() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
