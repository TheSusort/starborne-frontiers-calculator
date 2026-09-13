-- Per-refit stat grants for each unit, from the official unit catalogue
-- (starborne.com/api/unit-catalogue/unit-locale). Populated by
-- scripts/fetch-ascension-stats.ts; read by src/utils/ship/referenceShip.ts to
-- build a fully refitted reference ship for the combat simulator.
--
-- Shape: a jsonb array of {level, attribute, type, value}, where `level` runs
-- 0-6. Level 0 is INNATE and applies to an unrefitted ship; levels 1-6 are the
-- refits. `attribute` and `type` are the game's own vocabulary, mapped by
-- src/utils/ship/gameStatVocabulary.ts.
--
-- Nullable on purpose: a unit with no row loses the "fully refitted" option in
-- the picker rather than silently getting a wrong one.
ALTER TABLE public.ship_templates
  ADD COLUMN IF NOT EXISTS ascension_stats jsonb;

-- Size bound, measured rather than guessed: across all 150 units the largest
-- payload is 1,194 bytes (Hermes) and the mean is 557, so 16 KB is ~13x the real
-- ceiling. It exists to stop a malformed write from becoming a row every client
-- downloads with the template list, not to reject legitimate data.
--
-- octet_length(col::text), NEVER pg_column_size — the latter reports the
-- TOAST-COMPRESSED size on an existing row and the uncompressed size on insert,
-- so it measures two different things on write and on validate. See
-- 20260901000001_bound_community_recommendation_payload_size.sql for the
-- measurements behind that rule.
ALTER TABLE public.ship_templates
  ADD CONSTRAINT ship_templates_ascension_stats_size
  CHECK (ascension_stats IS NULL OR octet_length(ascension_stats::text) <= 16384) NOT VALID;

ALTER TABLE public.ship_templates
  VALIDATE CONSTRAINT ship_templates_ascension_stats_size;
