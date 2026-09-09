-- Re-encode `inventory_items.stats` from the long form to the compact array.
--
--   {"mainStat":{"name":"attack","type":"flat","value":60},"subStats":[…]}
--   ->  ["a60","k6","s3","C6"]
--
-- Measured 388.4 -> 146.5 B/row, ~149 MiB of live bytes across 644k rows
-- (docs/superpowers/specs/2026-09-09-gear-stats-encoding-measurement.md).
--
-- RUN ORDER MATTERS. Do not start until `encodeGearStats`/`decodeGearStats` have
-- shipped to production and baked: until then a client is still writing the long
-- form, and it would write it straight back into rows this script compacted.
-- `decodeGearStats` reads both shapes, so a partly-migrated table is fine — a
-- partly-DEPLOYED client is not.
--
-- Run it a step at a time in the Supabase SQL editor or a psql session against
-- the direct connection string. `psql` is not installed on the dev machine
-- (`brew install libpq`). This is not a PostgREST script: steps 4 and 5 need
-- `ctid` predicates and `VACUUM`, neither of which PostgREST exposes.
--
-- An UPDATE does not shrink the table file. That is expected and accepted: the
-- freed bytes become reusable space inside the existing file, so growth is
-- absorbed without the dashboard number rising. Step 5 is the one chance at an
-- actual file shrink, and it is gated on a measurement rather than assumed.


-- ============================================================
-- 1. Encoder
-- ============================================================
-- Mirrors src/utils/gear/statsCodec.ts. Both must agree; the round-trip test
-- over the real corpus guards the TypeScript side, and step 3 below is the
-- check for this side.

CREATE OR REPLACE FUNCTION public.gear_stat_cell(stat jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN s.symbol IS NULL THEN NULL
              WHEN s.percentage THEN upper(s.symbol)
              ELSE s.symbol END || (stat->>'value')
  FROM (
    SELECT
      CASE stat->>'name'
        WHEN 'attack'             THEN 'a'
        WHEN 'hp'                 THEN 'h'
        WHEN 'defence'            THEN 'd'
        WHEN 'crit'               THEN 'c'
        WHEN 'hacking'            THEN 'k'
        WHEN 'speed'              THEN 's'
        WHEN 'security'           THEN 'y'
        WHEN 'critDamage'         THEN 'p'
        WHEN 'healModifier'       THEN 'm'
        WHEN 'shield'             THEN 'e'
        WHEN 'hpRegen'            THEN 'r'
        WHEN 'defensePenetration' THEN 'n'
        WHEN 'shieldPenetration'  THEN 'i'
        WHEN 'damageReduction'    THEN 'u'
      END AS symbol,
      -- A percentage-only stat has no flat form, so its name settles the case
      -- even when the stored `type` says otherwise. Matches the decode rule.
      (stat->>'type' = 'percentage'
       OR stat->>'name' IN ('crit', 'critDamage', 'healModifier', 'shield',
                            'hpRegen', 'defensePenetration', 'shieldPenetration',
                            'damageReduction')) AS percentage
  ) s
$$;

CREATE OR REPLACE FUNCTION public.compact_gear_stats(stats jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  -- Slot 0 is always present and holds '' when the piece has no main stat:
  -- without the reserved slot, "no main + 2 substats" would be
  -- indistinguishable from "main + 1 substat".
  SELECT jsonb_build_array(coalesce(public.gear_stat_cell(stats->'mainStat'), ''))
      || coalesce(
           (SELECT jsonb_agg(public.gear_stat_cell(e))
            FROM jsonb_array_elements(coalesce(stats->'subStats', '[]'::jsonb)) e),
           '[]'::jsonb)
$$;


-- ============================================================
-- 2. Pre-flight: is there an unmappable stat name?
-- ============================================================
-- `gear_stat_cell` returns NULL for a name outside the 14-name table, and the
-- main-stat slot would coalesce that to '' — silently dropping a stat. STOP if
-- either query returns anything.

-- Every distinct stat name currently stored, with its count. Anything here that
-- is not one of the 14 in step 1 has to be added there first.
SELECT value->>'name' AS stat_name, count(*)
FROM inventory_items,
     LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(stats) = 'object'
            THEN coalesce(stats->'subStats', '[]'::jsonb)
                 || CASE WHEN jsonb_typeof(stats->'mainStat') = 'object'
                         THEN jsonb_build_array(stats->'mainStat')
                         ELSE '[]'::jsonb END
            ELSE '[]'::jsonb END) AS value
GROUP BY 1
ORDER BY 2 DESC;

-- Rows the encoder cannot represent. Must be 0.
SELECT count(*) AS unencodable_rows
FROM inventory_items
WHERE jsonb_typeof(stats) = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
           coalesce(stats->'subStats', '[]'::jsonb)
           || CASE WHEN jsonb_typeof(stats->'mainStat') = 'object'
                   THEN jsonb_build_array(stats->'mainStat')
                   ELSE '[]'::jsonb END) AS e
    WHERE public.gear_stat_cell(e) IS NULL
  );


-- ============================================================
-- 3. Prove the encoder round-trips before writing anything
-- ============================================================
-- An INDEPENDENT decoder: the symbol table below is spelled out again, in the
-- inverse direction, and deliberately does not call `gear_stat_cell`. A check
-- that decoded with the encoder's own table would pass even with a wrong
-- symbol in it — measured: swapping attack's 'a' for 'z' left such a check
-- reporting 0 mismatches while 2,123 rows were in fact being written wrong.
-- Two tables that must agree is the point; if you edit one, edit both.

CREATE OR REPLACE FUNCTION public.gear_cell_stat(cell text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN cell = '' OR cell IS NULL THEN NULL
              ELSE jsonb_build_object(
                'name', CASE lower(left(cell, 1))
                  WHEN 'a' THEN 'attack'
                  WHEN 'h' THEN 'hp'
                  WHEN 'd' THEN 'defence'
                  WHEN 'c' THEN 'crit'
                  WHEN 'k' THEN 'hacking'
                  WHEN 's' THEN 'speed'
                  WHEN 'y' THEN 'security'
                  WHEN 'p' THEN 'critDamage'
                  WHEN 'm' THEN 'healModifier'
                  WHEN 'e' THEN 'shield'
                  WHEN 'r' THEN 'hpRegen'
                  WHEN 'n' THEN 'defensePenetration'
                  WHEN 'i' THEN 'shieldPenetration'
                  WHEN 'u' THEN 'damageReduction'
                END,
                'value', substr(cell, 2)::numeric)
         END
$$;

-- `mismatched` must be 0. Compares (name, value) in order; `type` is excluded
-- because the encoder legitimately corrects a percentage-only stat stored as
-- flat, so a type difference there is a fix, not a fault.
WITH sample AS (
  SELECT id, stats, public.compact_gear_stats(stats) AS compact
  FROM inventory_items
  WHERE jsonb_typeof(stats) = 'object'
  LIMIT 20000
),
rebuilt AS (
  SELECT s.id,
         (SELECT jsonb_agg(jsonb_build_object('name', e->>'name',
                                              'value', (e->>'value')::numeric)
                           ORDER BY ord)
          FROM jsonb_array_elements(
                 jsonb_build_array(s.stats->'mainStat')
                 || coalesce(s.stats->'subStats', '[]'::jsonb))
               WITH ORDINALITY AS t(e, ord)
          WHERE jsonb_typeof(e) = 'object') AS from_long,
         (SELECT jsonb_agg(public.gear_cell_stat(cell) ORDER BY ord)
          FROM jsonb_array_elements_text(s.compact)
               WITH ORDINALITY AS u(cell, ord)
          WHERE cell <> '') AS from_compact
  FROM sample s
)
SELECT count(*) AS mismatched
FROM rebuilt
WHERE coalesce(from_long, '[]'::jsonb) <> coalesce(from_compact, '[]'::jsonb);


-- ============================================================
-- 4. Census — how much is left to do
-- ============================================================
-- Long-form rows are objects; compacted rows are arrays. Run this before and
-- after every batch. When `legacy_rows` reaches 0 the migration is complete and
-- the legacy branch of `decodeGearStats` can be dropped (the "contract" step).

SELECT
  count(*) FILTER (WHERE jsonb_typeof(stats) = 'object') AS legacy_rows,
  count(*) FILTER (WHERE jsonb_typeof(stats) = 'array')  AS compact_rows,
  count(*) FILTER (WHERE stats IS NULL)                  AS null_rows,
  pg_size_pretty(pg_relation_size('inventory_items'))    AS heap,
  pg_size_pretty(pg_total_relation_size('inventory_items')) AS total
FROM inventory_items;


-- ============================================================
-- 5. Tail-drain rehearsal — ONE batch, then measure, then decide
-- ============================================================
-- Plain VACUUM can truncate trailing empty pages. If the rewrite moves live
-- rows out of the tail into free space nearer the front, the file shrinks with
-- no extra disk. The expectation is that it will NOT: `stats` is unindexed and
-- the rewrite makes rows smaller, which is exactly the condition for a
-- heap-only-tuple update that keeps the new version on the SAME page. Updating
-- a whole page range inside one transaction is the mitigation — the old
-- versions cannot be pruned while the transaction is open, so the page fills
-- and later rows in the batch are forced to spill forward.
--
-- Note the encoding cuts both ways here: smaller new rows fit more easily on
-- the original page, so a more aggressive encoding makes draining LESS likely.
--
-- Record this number.
SELECT pg_relation_size('inventory_items') AS bytes_before;

-- One batch against the highest page range, in a single transaction.
BEGIN;
UPDATE inventory_items
SET stats = public.compact_gear_stats(stats)
WHERE jsonb_typeof(stats) = 'object'
  AND ctid >= (
    -- the last 2,000 pages
    SELECT ('(' || greatest(0, (pg_relation_size('inventory_items') / 8192)::int - 2000)
            || ',1)')::tid
  );
COMMIT;

VACUUM (VERBOSE) inventory_items;

SELECT pg_relation_size('inventory_items') AS bytes_after;

-- SHRANK       -> continue with step 6 ordered by ctid DESC, VACUUM between batches.
-- DID NOT      -> STOP expecting a file shrink. Run step 6 as plain unordered
--                 batches for the live-byte win and leave the file size alone.
-- Do not grind through 644k rows hoping. One measured batch decides it.


-- ============================================================
-- 5b. Change the column default BEFORE migrating rows
-- ============================================================
-- The column defaults to the legacy object:
--   stats jsonb NOT NULL DEFAULT '{"mainStat": null, "subStats": []}'::jsonb
-- so any INSERT that omits `stats` writes a legacy row — including after the
-- step-4 census reaches zero, which would then make the census lie and break
-- the contract step that drops the legacy decode branch.
--
-- '[""]' is what `encodeGearStats({mainStat: null, subStats: []})` produces:
-- slot 0 present and empty. Kept in step 5b rather than at the end so no row
-- inserted during the migration lands in the old shape.

ALTER TABLE inventory_items
  ALTER COLUMN stats SET DEFAULT '[""]'::jsonb;


-- ============================================================
-- 6. Batch migration
-- ============================================================
-- Bounded so no single statement holds a long lock on a hot table. Re-run until
-- step 4 reports `legacy_rows` = 0. Rows only ever get smaller, so no batch can
-- push the table past the quota.

UPDATE inventory_items
SET stats = public.compact_gear_stats(stats)
WHERE id IN (
  SELECT id FROM inventory_items
  WHERE jsonb_typeof(stats) = 'object'
  -- Add `ORDER BY ctid DESC` here only if step 5 measured a real shrink.
  LIMIT 20000
);

VACUUM inventory_items;


-- ============================================================
-- 7. Clean up
-- ============================================================
-- Only after step 4 reports `legacy_rows` = 0 and the app has been exercised
-- against the compacted data.

-- DROP FUNCTION public.compact_gear_stats(jsonb);
-- DROP FUNCTION public.gear_stat_cell(jsonb);

-- The index reclaim belongs last, on a table that is by then far smaller.
-- Reindexing earlier pays the compaction twice.
-- REINDEX INDEX CONCURRENTLY public.inventory_items_pkey;
-- REINDEX INDEX CONCURRENTLY public.idx_inventory_items_user_id_id;
-- Then confirm both are valid and no *_ccnew leftovers remain:
-- SELECT indexrelid::regclass, indisvalid FROM pg_index
-- WHERE indrelid = 'inventory_items'::regclass;
