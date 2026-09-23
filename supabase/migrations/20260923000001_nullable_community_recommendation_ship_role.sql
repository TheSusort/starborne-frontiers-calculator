-- `ship_role` mirrors `shared_config.shipRole`, or — in Custom mode — the role its formula
-- was seeded from (`mirroredShipRole`, src/utils/communityBuild.ts). A hand-written Custom
-- formula with no starting role has neither, so it legitimately has no value to mirror; NULL
-- records that (#544).
--
-- Audit of everything else that reads or constrains `ship_role`, across current-schema.sql
-- and every file in supabase/migrations/: no CHECK constraint, index, trigger, function, or
-- RLS policy names this column. The table's only policies (20260424000003_alt_accounts_rls.sql)
-- gate INSERT/UPDATE/DELETE on `created_by` via `public.has_profile_access`, and SELECT is
-- unconditionally public (20260221000004, applied before this repo tracked migrations) — a
-- NULL `ship_role` changes no policy's outcome. DROP NOT NULL is a catalog-only change: it
-- does not scan or rewrite the table, unlike adding a constraint.

ALTER TABLE public.community_recommendations
  ALTER COLUMN ship_role DROP NOT NULL;

COMMENT ON COLUMN public.community_recommendations.ship_role IS
  'Legacy mirror of shared_config.shipRole. NULL for a Custom-mode build with no role to mirror (a from-scratch formula, i.e. no seededFrom) — see mirroredShipRole in src/utils/communityBuild.ts.';
