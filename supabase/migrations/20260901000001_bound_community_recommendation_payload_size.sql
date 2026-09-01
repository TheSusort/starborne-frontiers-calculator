-- Bound the jsonb payloads on community_recommendations at the database.
--
-- The client already Zod-validates shared_config on write AND on read, and that
-- schema caps all five arrays at 50 entries (src/schemas/sharedAutogearBuild.ts,
-- MAX_ARRAY_LENGTH). That bound stops an oversized payload from being RENDERED.
-- It does not stop it from being TRANSFERRED: CommunityRecommendationService
-- .listForShip issues `select('*')`, so the whole row reaches every client that
-- opens the community panel for that ship and is only rejected after it has been
-- downloaded and parsed. The client-side bound protects the DOM, not bandwidth or
-- parse time.
--
-- The INSERT policy admits any authenticated user
-- (WITH CHECK public.has_profile_access(created_by)) and SELECT is public
-- (20260221000004), so a user going straight at PostgREST with their own JWT can
-- store a payload far larger than anything the UI produces. One such row degrades
-- the autogear panel for everyone viewing that ship. Raised by CodeRabbit on #429
-- as Denial of Service (CWE-400), filed as #431.
--
-- All four jsonb columns are bounded, not just shared_config. The legacy trio is
-- dual-written by the same code path and is the READ FALLBACK when shared_config
-- is absent (src/utils/communityBuild.ts), so a hostile row carrying
-- `shared_config: null` and a huge `stat_priorities` would replay the same denial
-- of service through the fallback path.
--
-- Bound rationale: the largest payload the client schema admits — 50 entries in
-- every array, longest real stat/set/implant keys, every optional field present,
-- and numbers at MAX_NUMBER_MAGNITUDE — measures 17,221 bytes of JSON, which
-- renders as 18,581 bytes of jsonb text (1.08x, from the `": "` / `", "`
-- separators). Both are pinned by a test in
-- src/schemas/sharedAutogearBuild.test.ts asserting the payload stays under half
-- this bound. 64 KB is therefore ~3.5x the real ceiling: it exists to cap a
-- hostile row, never to reject a legitimate build.
--
-- WHY octet_length(col::text) AND NOT pg_column_size(col)
--
-- pg_column_size was the obvious choice and is wrong here, in two ways. Both
-- measured on postgres:16-alpine.
--
-- 1. It reports the value's STORED size, so on an existing row it sees the
--    TOAST-COMPRESSED bytes — a planted 170,000-byte array of repeated strings
--    reports just 2,584. On INSERT the datum is not yet compressed, so the same
--    expression sees the full size and rejects it. The constraint would measure
--    two different things on write and on validate, and VALIDATE CONSTRAINT would
--    wave through exactly the pre-existing hostile rows it is supposed to catch
--    (verified: it did).
-- 2. It undercounts the threat for the adversarial case. jsonb numbers are stored
--    as `numeric` — compact in binary, but rendered without exponents. An array of
--    500 `1e308` literals occupies 8,006 bytes by pg_column_size and 155,500 on
--    the wire: a 64 KB pg_column_size gate would have ACCEPTED that row, a ~19x
--    undercount. octet_length rejects it.
--
-- octet_length(col::text) is the honest measure:
--   * identical on write and on validate — no compression in the basis;
--   * it counts the bytes PostgREST actually sends to every viewer, which is the
--     quantity the denial of service is about;
--   * it is the same basis as the client-side test, so the two layers compare
--     directly with no conversion factor;
--   * both jsonb_out and octet_length are IMMUTABLE (pg_proc.provolatile = 'i'),
--     unlike pg_column_size which is merely STABLE.
-- The cast renders canonical jsonb (normalised whitespace, deduplicated keys),
-- which is also the form the API returns, so it cannot undercount the wire size.
--
-- No RLS change: RLS is row-level, and these are column constraints.
--
-- Added NOT VALID, then validated in a second pass, so that a future reader
-- copying this pattern onto a big table has the right shape to start from. Be
-- clear about what that does and does not buy HERE, though:
--
-- If this file runs inside one transaction — which is how both `supabase db push`
-- and the dashboard SQL editor run it — the split buys nothing. Measured on
-- postgres:16-alpine: `ADD CONSTRAINT ... NOT VALID` takes ACCESS EXCLUSIVE, and
-- Postgres holds locks until commit, so the VALIDATE below runs under that same
-- ACCESS EXCLUSIVE and writes stay blocked for the whole transaction. Only when
-- the VALIDATE lives in a SEPARATE transaction does it drop to SHARE UPDATE
-- EXCLUSIVE (also measured), which is what lets concurrent writes through.
--
-- That is fine for this table, which holds a handful of rows per ship, and the
-- scan is milliseconds. **On a large table, put the VALIDATE in its own
-- migration** — that is the only version of this pattern that actually avoids
-- blocking writes.
--
-- Keeping the VALIDATE here is deliberate for a different reason: existing rows
-- get checked at apply time, so if prod somehow holds an oversized row this fails
-- loudly rather than leaving a permanently unvalidated constraint behind.
--
-- Replayed verbatim against this table's real shape on postgres:16-alpine, all
-- five properties confirmed:
--   * clean apply + validate over a pre-existing legitimate row;
--   * the maximal client-valid shared_config (the 17,221-byte payload the test
--     builds, inserted as real jsonb) is ACCEPTED — the bound does not reject a
--     legitimate build;
--   * the fallback-path attack (shared_config NULL plus a ~170 KB
--     stat_priorities) is rejected on write;
--   * the exponent-amplified payload (500 x 1e308, 155,500 wire bytes) is
--     rejected on write;
--   * with an oversized row planted BEFORE the migration, VALIDATE CONSTRAINT is
--     what fails — the alarm this migration is supposed to raise.

ALTER TABLE public.community_recommendations
  ADD CONSTRAINT community_recommendations_shared_config_size
  CHECK (shared_config IS NULL OR octet_length(shared_config::text) <= 65536) NOT VALID;

ALTER TABLE public.community_recommendations
  ADD CONSTRAINT community_recommendations_stat_priorities_size
  CHECK (stat_priorities IS NULL OR octet_length(stat_priorities::text) <= 65536) NOT VALID;

ALTER TABLE public.community_recommendations
  ADD CONSTRAINT community_recommendations_stat_bonuses_size
  CHECK (stat_bonuses IS NULL OR octet_length(stat_bonuses::text) <= 65536) NOT VALID;

ALTER TABLE public.community_recommendations
  ADD CONSTRAINT community_recommendations_set_priorities_size
  CHECK (set_priorities IS NULL OR octet_length(set_priorities::text) <= 65536) NOT VALID;

-- Second pass: check the pre-existing rows. Under SHARE UPDATE EXCLUSIVE, so
-- concurrent writes are unaffected. A failure here means prod already holds an
-- oversized row — investigate that row, do not drop the constraint.
ALTER TABLE public.community_recommendations
  VALIDATE CONSTRAINT community_recommendations_shared_config_size;

ALTER TABLE public.community_recommendations
  VALIDATE CONSTRAINT community_recommendations_stat_priorities_size;

ALTER TABLE public.community_recommendations
  VALIDATE CONSTRAINT community_recommendations_stat_bonuses_size;

ALTER TABLE public.community_recommendations
  VALIDATE CONSTRAINT community_recommendations_set_priorities_size;
