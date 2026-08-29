-- Community recommendations previously stored only stat_priorities, stat_bonuses
-- and set_priorities, so a shared build could not reproduce the result its author
-- saw: fleet buffs, implant inclusion and implant exclusions were all lost.
--
-- shared_config holds a versioned SharedAutogearBuild (see
-- src/schemas/sharedAutogearBuild.ts). The legacy columns keep being written in
-- parallel so a stale cached client bundle keeps working, and rows written
-- before this migration are read back through those columns.
--
-- No new RLS policies: community_recommendations already has RLS enabled, with
-- a public SELECT policy (20260221000004) and row-level INSERT/UPDATE/DELETE
-- policies (20260424000003_alt_accounts_rls.sql). RLS is row-level, so a new
-- column on an existing table is covered by them.

ALTER TABLE public.community_recommendations
  ADD COLUMN IF NOT EXISTS shared_config jsonb;

COMMENT ON COLUMN public.community_recommendations.shared_config IS
  'Versioned SharedAutogearBuild payload. Validated client-side on read; null on pre-2026-08-29 rows.';
