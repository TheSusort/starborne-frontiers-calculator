-- Relax community_recommendations.ship_role from NOT NULL to nullable, so a Custom-mode
-- build with no role to mirror (mirroredShipRole, src/utils/communityBuild.ts) can be shared.
--
-- RLS on this table gates INSERT on the owner column (has_profile_access(created_by)), not on
-- ship_role, so this NOT NULL constraint is the only server-side barrier to a null-role row —
-- without it, any authenticated user could write one straight through PostgREST regardless of
-- what the client's ALLOW_ROLELESS_COMMUNITY_SHARE switch says. Apply this before flipping that
-- switch on (#552).

ALTER TABLE public.community_recommendations
  ALTER COLUMN ship_role DROP NOT NULL;
