-- Page tracking: one row per page visit and per distinct client error, rolled up nightly.
--
-- Clients never write tables directly: track_page_events (SECURITY DEFINER) validates every row and
-- silently drops what fails, because the anon key is public and anyone can call it. The daily
-- ceilings in tracking_ingest_counts (10,000 visit writes and 1,000 error writes per UTC day)
-- bound how much junk one day can hold, and text and click maps are bounded in bytes.
--
-- Raw rows live 14 days. rollup_page_tracking() writes the daily tables, keeping per day only the
-- top 200 pages, 1000 click keys, 100 referrers and 100 errors, and prunes rollup rows older than
-- 400 days. Schedule it
-- with pg_cron outside this migration:
--   select cron.schedule('rollup-page-tracking', '15 3 * * *',
--                        $$select public.rollup_page_tracking()$$);

BEGIN;

CREATE TABLE IF NOT EXISTS public.page_visits (
  id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  path text NOT NULL,
  entered_at timestamptz NOT NULL,
  active_ms integer NOT NULL CHECK (active_ms BETWEEN 0 AND 1800000),
  clicks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(clicks::text) <= 4096),
  is_entry boolean NOT NULL DEFAULT false,
  referrer_host text NULL,
  device text NOT NULL CHECK (device IN ('mobile', 'tablet', 'desktop')),
  app_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_visits_created_at_idx ON public.page_visits (created_at);
CREATE INDEX IF NOT EXISTS page_visits_session_idx ON public.page_visits (session_id, entered_at);
-- Serves the ON DELETE SET NULL action when a user is deleted.
CREATE INDEX IF NOT EXISTS page_visits_user_id_idx ON public.page_visits (user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  message text NOT NULL,
  stack text NOT NULL,
  path text NOT NULL,
  app_version text NOT NULL,
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_errors_created_at_idx ON public.client_errors (created_at);

CREATE TABLE IF NOT EXISTS public.tracking_ingest_counts (
  day date PRIMARY KEY,
  visits integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.traffic_daily (
  day date PRIMARY KEY,
  views integer NOT NULL,
  visitors integer NOT NULL,
  sessions integer NOT NULL,
  visitors_mobile integer NOT NULL,
  visitors_tablet integer NOT NULL,
  visitors_desktop integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.page_daily (
  day date NOT NULL,
  path text NOT NULL,
  views integer NOT NULL,
  visitors integer NOT NULL,
  entries integer NOT NULL,
  exits integer NOT NULL,
  total_active_ms bigint NOT NULL,
  PRIMARY KEY (day, path)
);

CREATE TABLE IF NOT EXISTS public.referrer_daily (
  day date NOT NULL,
  referrer_host text NOT NULL,
  entries integer NOT NULL,
  PRIMARY KEY (day, referrer_host)
);

CREATE TABLE IF NOT EXISTS public.click_daily (
  day date NOT NULL,
  path text NOT NULL,
  track_id text NOT NULL,
  clicks integer NOT NULL,
  PRIMARY KEY (day, path, track_id)
);

CREATE TABLE IF NOT EXISTS public.error_daily (
  day date NOT NULL,
  fingerprint text NOT NULL,
  app_version text NOT NULL,
  count integer NOT NULL,
  visitors integer NOT NULL,
  sample_message text NOT NULL,
  sample_stack text NOT NULL,
  sample_path text NOT NULL,
  PRIMARY KEY (day, fingerprint, app_version)
);

-- RLS: admins may read; nobody writes through the REST API. anon has no table privileges and
-- authenticated has SELECT only, which the policy narrows to admins. The SECURITY DEFINER
-- functions below bypass RLS and are the only writers.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'page_visits', 'client_errors', 'tracking_ingest_counts', 'traffic_daily',
    'page_daily', 'referrer_daily', 'click_daily', 'error_daily'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can read" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Admins can read" ON public.%I FOR SELECT TO authenticated USING (public.is_admin())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ingest
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.track_page_events(
  p_visits jsonb DEFAULT '[]'::jsonb,
  p_errors jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  path_re constant text := '^(/[A-Za-z0-9:_-]*)+$|^\*$';
  uid uuid;
  today date := (now() AT TIME ZONE 'UTC')::date;
  visits_left integer;
  errors_left integer;
  accepted_visits integer := 0;
  accepted_errors integer := 0;
  v jsonb;
  e jsonb;
  ts timestamptz;
  clean_clicks jsonb;
  msg text;
  stk text;
BEGIN
  -- Admin browsing would otherwise be the largest single visitor.
  IF public.is_admin() THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_visits) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_errors) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  IF NOT public.is_anonymous_session() THEN
    SELECT id INTO uid FROM public.users WHERE id = auth.uid();
  END IF;

  INSERT INTO public.tracking_ingest_counts (day) VALUES (today) ON CONFLICT (day) DO NOTHING;
  SELECT greatest(10000 - visits, 0), greatest(1000 - errors, 0)
    INTO visits_left, errors_left
    FROM public.tracking_ingest_counts WHERE day = today;

  FOR v IN
    SELECT value FROM jsonb_array_elements(p_visits) WITH ORDINALITY AS t(value, n)
     WHERE n <= least(20, visits_left)
  LOOP
    BEGIN
      IF NOT (v->>'path' ~ path_re AND length(v->>'path') <= 100
              AND v->>'device' IN ('mobile', 'tablet', 'desktop')) THEN
        CONTINUE;
      END IF;

      SELECT coalesce(jsonb_object_agg(key, cnt), '{}'::jsonb) INTO clean_clicks
        FROM (
          SELECT key, least(greatest(round((value #>> '{}')::numeric), 1), 999)::int AS cnt
            FROM jsonb_each(CASE WHEN jsonb_typeof(v->'clicks') = 'object'
                                 THEN v->'clicks' ELSE '{}'::jsonb END)
           WHERE key ~ '^[a-z0-9._-]{1,64}$' AND jsonb_typeof(value) = 'number'
           LIMIT 20
        ) c;
      IF octet_length(clean_clicks::text) > 2048 THEN
        CONTINUE;
      END IF;

      ts := (v->>'entered_at')::timestamptz;
      IF ts IS NULL OR ts < now() - interval '1 day' OR ts > now() + interval '5 minutes' THEN
        ts := now();
      END IF;

      INSERT INTO public.page_visits AS pv (
        id, visitor_id, session_id, user_id, path, entered_at, active_ms, clicks,
        is_entry, referrer_host, device, app_version
      ) VALUES (
        (v->>'id')::uuid,
        (v->>'visitor_id')::uuid,
        (v->>'session_id')::uuid,
        uid,
        v->>'path',
        ts,
        least(greatest(coalesce(round((v->>'active_ms')::numeric), 0), 0), 1800000)::int,
        clean_clicks,
        coalesce((v->>'is_entry')::boolean, false),
        CASE WHEN v->>'referrer_host' ~ '^[A-Za-z0-9.-]{1,253}$'
             THEN lower(v->>'referrer_host') END,
        v->>'device',
        CASE WHEN v->>'app_version' ~ '^[0-9.]{1,20}$' THEN v->>'app_version' ELSE 'unknown' END
      )
      -- A later snapshot of the same visit. Matching session_id keeps one visitor from rewriting
      -- another's row even if an id leaked.
      ON CONFLICT (id) DO UPDATE
        SET active_ms = greatest(pv.active_ms, EXCLUDED.active_ms),
            clicks = EXCLUDED.clicks,
            user_id = coalesce(pv.user_id, EXCLUDED.user_id)
        WHERE pv.session_id = EXCLUDED.session_id;

      accepted_visits := accepted_visits + 1;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
  END LOOP;

  FOR e IN
    SELECT value FROM jsonb_array_elements(p_errors) WITH ORDINALITY AS t(value, n)
     WHERE n <= least(10, errors_left)
  LOOP
    BEGIN
      IF NOT (e->>'fingerprint' ~ '^[0-9a-f]{8}$') THEN
        CONTINUE;
      END IF;
      -- Byte bounds (4 bytes per UTF-8 character at the character limits) drop the row outright.
      msg := left(coalesce(e->>'message', ''), 300);
      stk := left(coalesce(e->>'stack', ''), 2000);
      IF octet_length(msg) > 1200 OR octet_length(stk) > 8000 THEN
        CONTINUE;
      END IF;
      INSERT INTO public.client_errors (
        fingerprint, message, stack, path, app_version, visitor_id, session_id
      ) VALUES (
        e->>'fingerprint',
        msg,
        stk,
        CASE WHEN e->>'path' ~ path_re AND length(e->>'path') <= 100 THEN e->>'path' ELSE '*' END,
        CASE WHEN e->>'app_version' ~ '^[0-9.]{1,20}$' THEN e->>'app_version' ELSE 'unknown' END,
        (e->>'visitor_id')::uuid,
        (e->>'session_id')::uuid
      );
      accepted_errors := accepted_errors + 1;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
  END LOOP;

  IF accepted_visits + accepted_errors > 0 THEN
    UPDATE public.tracking_ingest_counts
       SET visits = visits + accepted_visits, errors = errors + accepted_errors
     WHERE day = today;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Rollup
-- ---------------------------------------------------------------------------------------------

-- Rebuilds every rollup row for one UTC day from raw rows. Idempotent: delete, then insert.
-- A per-day advisory lock serialises concurrent rebuilds of the same day, which would otherwise
-- both delete and then collide on the primary keys when inserting. Each daily table keeps only
-- the day's top keys (row_number with the key columns as tiebreak), so junk keys cannot grow it.
CREATE OR REPLACE FUNCTION public.rollup_page_tracking_day(p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  day_start timestamptz := p_day::timestamp AT TIME ZONE 'UTC';
  day_end timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rollup_page_tracking_day'), (p_day - date '2000-01-01'));

  DELETE FROM public.traffic_daily WHERE day = p_day;
  DELETE FROM public.page_daily WHERE day = p_day;
  DELETE FROM public.referrer_daily WHERE day = p_day;
  DELETE FROM public.click_daily WHERE day = p_day;
  DELETE FROM public.error_daily WHERE day = p_day;

  INSERT INTO public.traffic_daily
  SELECT p_day, count(*), count(DISTINCT visitor_id), count(DISTINCT session_id),
         count(DISTINCT visitor_id) FILTER (WHERE device = 'mobile'),
         count(DISTINCT visitor_id) FILTER (WHERE device = 'tablet'),
         count(DISTINCT visitor_id) FILTER (WHERE device = 'desktop')
    FROM public.page_visits
   WHERE created_at >= day_start AND created_at < day_end
  HAVING count(*) > 0;

  -- The exit page of a session is its last visit by entered_at.
  INSERT INTO public.page_daily (day, path, views, visitors, entries, exits, total_active_ms)
  WITH day_rows AS (
    SELECT * FROM public.page_visits WHERE created_at >= day_start AND created_at < day_end
  ), exit_ids AS (
    SELECT DISTINCT ON (session_id) id FROM day_rows ORDER BY session_id, entered_at DESC
  ), per_path AS (
    SELECT r.path AS k_path,
           count(*) AS n_views,
           count(DISTINCT r.visitor_id) AS n_visitors,
           count(*) FILTER (WHERE r.is_entry) AS n_entries,
           count(*) FILTER (WHERE r.id IN (SELECT id FROM exit_ids)) AS n_exits,
           coalesce(sum(r.active_ms), 0) AS n_active_ms
      FROM day_rows r
     GROUP BY r.path
  ), ranked AS (
    SELECT per_path.*, row_number() OVER (ORDER BY n_views DESC, k_path) AS rn FROM per_path
  )
  SELECT p_day, k_path, n_views, n_visitors, n_entries, n_exits, n_active_ms
    FROM ranked
   WHERE rn <= 200;

  INSERT INTO public.referrer_daily (day, referrer_host, entries)
  SELECT p_day, k_host, n_entries
    FROM (
      SELECT k_host, n_entries, row_number() OVER (ORDER BY n_entries DESC, k_host) AS rn
        FROM (
          SELECT coalesce(referrer_host, '(direct)') AS k_host, count(*) AS n_entries
            FROM public.page_visits
           WHERE created_at >= day_start AND created_at < day_end AND is_entry
           GROUP BY 1
        ) agg
    ) ranked
   WHERE rn <= 100;

  INSERT INTO public.click_daily (day, path, track_id, clicks)
  SELECT p_day, k_path, k_track, n_clicks
    FROM (
      SELECT k_path, k_track, n_clicks,
             row_number() OVER (ORDER BY n_clicks DESC, k_path, k_track) AS rn
        FROM (
          SELECT pv.path AS k_path, c.key AS k_track, sum(c.value::int) AS n_clicks
            FROM public.page_visits pv, jsonb_each_text(pv.clicks) c
           WHERE pv.created_at >= day_start AND pv.created_at < day_end
           GROUP BY pv.path, c.key
        ) agg
    ) ranked
   WHERE rn <= 1000;

  INSERT INTO public.error_daily (
    day, fingerprint, app_version, count, visitors, sample_message, sample_stack, sample_path
  )
  SELECT p_day, k_fingerprint, k_version, n_count, n_visitors, s_message, s_stack, s_path
    FROM (
      SELECT agg.*,
             row_number() OVER (ORDER BY n_count DESC, k_fingerprint, k_version) AS rn
        FROM (
          SELECT fingerprint AS k_fingerprint, app_version AS k_version,
                 count(*) AS n_count, count(DISTINCT visitor_id) AS n_visitors,
                 (array_agg(message ORDER BY created_at DESC))[1] AS s_message,
                 (array_agg(stack ORDER BY created_at DESC))[1] AS s_stack,
                 (array_agg(path ORDER BY created_at DESC))[1] AS s_path
            FROM public.client_errors
           WHERE created_at >= day_start AND created_at < day_end
           GROUP BY fingerprint, app_version
        ) agg
    ) ranked
   WHERE rn <= 100;
END;
$$;

-- Nightly: rebuild the last two complete days (late snapshots land after midnight), then prune
-- raw rows after 14 days and rollup rows after 400 days.
CREATE OR REPLACE FUNCTION public.rollup_page_tracking()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM public.rollup_page_tracking_day(today - 2);
  PERFORM public.rollup_page_tracking_day(today - 1);
  DELETE FROM public.page_visits WHERE created_at < now() - interval '14 days';
  DELETE FROM public.client_errors WHERE created_at < now() - interval '14 days';
  DELETE FROM public.tracking_ingest_counts WHERE day < today - 14;
  DELETE FROM public.traffic_daily WHERE day < today - 400;
  DELETE FROM public.page_daily WHERE day < today - 400;
  DELETE FROM public.referrer_daily WHERE day < today - 400;
  DELETE FROM public.click_daily WHERE day < today - 400;
  DELETE FROM public.error_daily WHERE day < today - 400;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin read
-- ---------------------------------------------------------------------------------------------

-- Rebuilds today's rollup first, so the dashboard includes the current day.
CREATE OR REPLACE FUNCTION public.get_traffic_summary(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'UTC')::date;
  since date := today - (least(greatest(coalesce(p_days, 7), 1), 365) - 1);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM public.rollup_page_tracking_day(today);

  RETURN jsonb_build_object(
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'day', day, 'views', views, 'visitors', visitors, 'sessions', sessions)
             ORDER BY day)
        FROM public.traffic_daily WHERE day >= since), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(p ORDER BY (p->>'views')::bigint DESC) FROM (
        SELECT jsonb_build_object(
                 'path', path, 'views', sum(views), 'entries', sum(entries), 'exits', sum(exits),
                 'avg_active_ms', (sum(total_active_ms) / nullif(sum(views), 0))::bigint) AS p
          FROM public.page_daily WHERE day >= since
         GROUP BY path ORDER BY sum(views) DESC, path LIMIT 200) s), '[]'::jsonb),
    'referrers', coalesce((
      SELECT jsonb_agg(r ORDER BY (r->>'entries')::bigint DESC) FROM (
        SELECT jsonb_build_object('referrer_host', referrer_host, 'entries', sum(entries)) AS r
          FROM public.referrer_daily WHERE day >= since
         GROUP BY referrer_host ORDER BY sum(entries) DESC LIMIT 50) s), '[]'::jsonb),
    'devices', (
      SELECT jsonb_build_object(
               'mobile', coalesce(sum(visitors_mobile), 0),
               'tablet', coalesce(sum(visitors_tablet), 0),
               'desktop', coalesce(sum(visitors_desktop), 0))
        FROM public.traffic_daily WHERE day >= since),
    'clicks', coalesce((
      SELECT jsonb_agg(c ORDER BY (c->>'clicks')::bigint DESC) FROM (
        SELECT jsonb_build_object('path', path, 'track_id', track_id, 'clicks', sum(clicks)) AS c
          FROM public.click_daily WHERE day >= since
         GROUP BY path, track_id ORDER BY sum(clicks) DESC LIMIT 500) s), '[]'::jsonb),
    'errors', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'count')::bigint DESC) FROM (
        SELECT jsonb_build_object(
                 'fingerprint', fingerprint, 'app_version', app_version,
                 'count', sum(count), 'visitors', sum(visitors), 'last_seen', max(day),
                 'sample_message', (array_agg(sample_message ORDER BY day DESC))[1],
                 'sample_stack', (array_agg(sample_stack ORDER BY day DESC))[1],
                 'sample_path', (array_agg(sample_path ORDER BY day DESC))[1]) AS x
          FROM public.error_daily WHERE day >= since
         GROUP BY fingerprint, app_version ORDER BY sum(count) DESC LIMIT 50) s), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_page_events(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_page_events(jsonb, jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.rollup_page_tracking_day(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollup_page_tracking() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_traffic_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_traffic_summary(integer) TO authenticated;

COMMIT;
