-- `pruneSupabaseDataNotInLocal` deletes stale autogear_configs rows gated on
-- `updated_at <= <max updated_at seen in the read>`, so that a config saved
-- between the stale read and the delete survives the prune.
--
-- That gate is inert without this trigger: `updated_at`'s DEFAULT applies only
-- on INSERT, and neither upsert site (AutogearConfigContext.saveConfig, and
-- step 7 of reuploadLocalDataToSupabase) sets the column, so the UPDATE branch
-- of an upsert left the timestamp at its original value.
--
-- Reuses `public.update_updated_at_column()`, declared in
-- 20260315000001_create_arena_seasons.sql.

DROP TRIGGER IF EXISTS update_autogear_configs_updated_at ON public.autogear_configs;

CREATE TRIGGER update_autogear_configs_updated_at
  BEFORE UPDATE ON public.autogear_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
