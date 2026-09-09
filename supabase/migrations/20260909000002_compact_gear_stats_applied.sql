-- Records the state that the gear-stats compaction (#493) left production in.
--
-- The row migration itself ALREADY RAN against production on 2026-09-09: all
-- 655,402 rows of inventory_items.stats were rewritten from the long-form
-- object to the compact array in 32 batched UPDATEs. This file exists so the
-- repo is not behind production on the DDL that came with it; every statement
-- is idempotent, so re-running it is a no-op.
--
-- Wire format: ["a60","k6","s3","C6"] - one string per stat, slot 0 reserved
-- for the main stat ('' meaning none), a fused leading symbol carrying both the
-- stat name and its type (uppercase = percentage). The only reader/writer is
-- src/utils/gear/statsCodec.ts.

-- The old default was '{"mainStat": null, "subStats": []}'::jsonb, so any
-- insert that omitted stats created a legacy-shaped row. That would make the
-- "zero legacy rows" census lie and block ever dropping the legacy decode
-- branch in decodeGearStats.
ALTER TABLE public.inventory_items
    ALTER COLUMN stats SET DEFAULT '[""]'::jsonb;

-- The encoder and the verifier's independent inverse decoder were installed
-- only to run the migration. compact_gear_stats is a footgun afterwards: it
-- reads stats->'mainStat', which on an already-compact ARRAY is NULL, so a
-- second call against a migrated row returns '[""]' and destroys that gear's
-- stats. Definitions are kept in scripts/sql/compact-gear-stats.sql.
DROP FUNCTION IF EXISTS public.compact_gear_stats(jsonb);
DROP FUNCTION IF EXISTS public.gear_stat_cell(jsonb);
DROP FUNCTION IF EXISTS public.gear_cell_stat(text);

-- Nothing references inventory_items.created_at: not src/, not a server-side
-- function, not a view, not a cron command. Its pg_stat_user_indexes idx_scan
-- is NOT the argument for dropping it - those counters had been zeroed since
-- the 821 lifetime scans recorded on 2026-08-30, which is why the definitions
-- were checked instead.
DROP INDEX IF EXISTS public.idx_inventory_items_created_at;
