-- `pruneSupabaseDataNotInLocal` deletes stale engineering_stats rows gated on
-- `updated_at <= <max updated_at seen in the read>`, so that a stat saved
-- between the stale read and the delete survives the prune.
--
-- The window is reachable because both writers upsert on the natural key
-- `(user_id, ship_type, stat_name)`: EngineeringStatsProvider.saveEngineeringStats
-- and step 6 of reuploadLocalDataToSupabase. A natural-key upsert can UPDATE a
-- cloud row the local snapshot does not name — which is exactly a row the prune
-- has already counted as stale.
--
-- The column is added here rather than at table creation, so existing rows need
-- a backfill: without one their NULL `updated_at` fails `<=` and the prune
-- silently stops removing them.
--
-- The gate is inert without the trigger: `updated_at`'s DEFAULT applies only on
-- INSERT, and neither upsert site sets the column, so the UPDATE branch of an
-- upsert would leave the timestamp at its original value.
--
-- Reuses `public.update_updated_at_column()`, declared in
-- 20260315000001_create_arena_seasons.sql.

ALTER TABLE public.engineering_stats
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone
  DEFAULT timezone('utc'::text, now());

UPDATE public.engineering_stats
  SET updated_at = timezone('utc'::text, now())
  WHERE updated_at IS NULL;

ALTER TABLE public.engineering_stats
  ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS update_engineering_stats_updated_at ON public.engineering_stats;

CREATE TRIGGER update_engineering_stats_updated_at
  BEFORE UPDATE ON public.engineering_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
