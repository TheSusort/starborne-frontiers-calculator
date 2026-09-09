# Rewriting `inventory_items` into the compact stats encoding

The alternative to `compact-gear-stats.sql`'s batched `UPDATE`. Both produce the
same rows; they differ in what happens to the **file**.

|                              | batched `UPDATE`      | this rewrite      |
| ---------------------------- | --------------------- | ----------------- |
| dashboard after              | ~445 MB (unchanged)   | **~211 MB**       |
| peak during                  | ~466-506 MB (tight)   | 195 MB            |
| downtime                     | none                  | **5-10 min**      |
| recovery if it fails halfway | rows are still valid  | **restore a file** |

An `UPDATE` never shrinks a table file — freed bytes become reusable space
inside it. `TRUNCATE` unlinks the file (verified: `relfilenode` changes and size
goes to 0), which is why this path is the only one that moves the number the
quota is measured against.

**Sizes** are from `docs/superpowers/specs/2026-09-09-gear-stats-encoding-measurement.md`
(gitignored, main checkout): 655,402 rows at 146.5 B/row = 92 MB heap, plus ~46 MB
of rebuilt indexes. The index figure is the *expected unbloated* size, not a
measured post-rebuild one — if they rebuild larger the final number rises by the
difference, which the 200 MB of peak headroom absorbs.

## Before you start

**The codec must be deployed and baked.** This is the binding constraint, and it
is stricter here than for the batched path: a rewrite flips all 655k rows at
once, and the currently-deployed client reads `statsData.mainStat` off the raw
value. Hand an array to an old client and every user's gear reads as statless.
`decodeGearStats` reads both shapes, so a half-migrated table is fine — a
half-deployed client is not.

Confirm on the live site, not in CI: open the inventory, one ship's stats, and
the leaderboard.

**`psql` is required.** Supabase exposes no server filesystem, so `COPY TO
'/path'` is unavailable — this is `\copy`, which streams client-side. The
Supabase SQL editor cannot run the whole thing either: it wraps submissions in a
transaction, and `VACUUM` and `REINDEX CONCURRENTLY` both refuse to run inside
one (`ERROR: VACUUM cannot run inside a transaction block`).

    psql "$(direct connection string from Project Settings -> Database)"

Use the **direct** string, not the pooler.

## Step 1 — install the encoder

Sections 1 and 3 of `compact-gear-stats.sql`: `gear_stat_cell`,
`compact_gear_stats`, `gear_cell_stat`. Then run its **step 2** (unencodable-row
census) and **step 3** (round-trip verifier). Both must report `0`. Stop if not —
a name outside the 14-symbol table encodes to `NULL`, and the main-stat slot
would coalesce that to `''`, silently dropping a stat.

## Step 2 — dump, re-encoded

    \copy (SELECT id, user_id, calibration_ship_id, slot, rarity, set_bonus,
                  level, stars, created_at, updated_at,
                  public.compact_gear_stats(stats) AS stats
           FROM inventory_items
           WHERE jsonb_typeof(stats) = 'object'
           UNION ALL
           SELECT id, user_id, calibration_ship_id, slot, rarity, set_bonus,
                  level, stars, created_at, updated_at, stats
           FROM inventory_items
           WHERE jsonb_typeof(stats) <> 'object')
      TO 'gear-compact.tsv'

The `UNION ALL` matters: re-encoding an already-compact row would fail, and rows
may already be compact if a batched run was started. Keep the column order —
step 5 depends on it.

## Step 3 — VERIFY THE DUMP. Do not skip.

For the next few minutes this file is the only copy.

    -- expected row count
    SELECT count(*) FROM inventory_items;

    $ wc -l gear-compact.tsv          # must match exactly
    $ head -2 gear-compact.tsv        # stats column must look like ["a60","k6"]
    $ grep -c 'mainStat' gear-compact.tsv   # must be 0

A count mismatch, or any `mainStat` left in the file, means stop.

## Step 4 — drop the four inbound foreign keys

    ALTER TABLE ship_equipment         DROP CONSTRAINT ship_equipment_new_gear_id_fkey;
    ALTER TABLE loadout_equipment      DROP CONSTRAINT loadout_equipment_new_gear_id_fkey;
    ALTER TABLE team_loadout_equipment DROP CONSTRAINT team_loadout_equipment_new_gear_id_fkey;
    ALTER TABLE ship_implants          DROP CONSTRAINT ship_implants_id_fkey;

Confirm the names first — they are from `supabase/current-schema.sql` and three
carry a `_new_` infix:

    SELECT conrelid::regclass AS child, conname
    FROM pg_constraint
    WHERE confrelid = 'inventory_items'::regclass AND contype = 'f';

`TRUNCATE` is refused while any of these exist — **including when the child
tables are empty**, because it is the constraint that blocks it, not the data.
Do not reach for `TRUNCATE ... CASCADE`: it would empty all four children plus
`ship_implant_stats`.

## Step 5 — truncate and reload

    TRUNCATE inventory_items;
    \copy inventory_items (id, user_id, calibration_ship_id, slot, rarity,
                           set_bonus, level, stars, created_at, updated_at, stats)
      FROM 'gear-compact.tsv'

Gear data does not exist between these two commands. RLS policies, indexes,
defaults and grants all survive — `TRUNCATE` replaces the file, not the table.
That is the main reason to prefer this over `CREATE TABLE AS` + swap, which
copies none of them and would have you rebuilding RLS on the most sensitive
table in the schema.

## Step 6 — restore the constraints

Same four, reversed. **The re-add is itself a completeness check**: if the reload
lost a row that a child still references, Postgres refuses with

    ERROR: insert or update on table "ship_equipment" violates foreign key constraint
    DETAIL: Key (gear_id)=(...) is not present in table "inventory_items".

so a lossy reload cannot pass silently. If that fires, the dump is still on disk
— diagnose before doing anything else.

## Step 7 — set the column default

    ALTER TABLE inventory_items ALTER COLUMN stats SET DEFAULT '[""]'::jsonb;

The column defaults to the legacy object, so any insert omitting `stats` would
recreate a legacy row. `'[""]'` is what `encodeGearStats({mainStat: null,
subStats: []})` produces.

## Step 8 — reindex, then measure

    REINDEX TABLE CONCURRENTLY inventory_items;
    DROP INDEX IF EXISTS idx_inventory_items_created_at;   -- 11 MB, 821 lifetime scans, unused
    VACUUM ANALYZE inventory_items;

    SELECT count(*) AS rows,
           count(*) FILTER (WHERE jsonb_typeof(stats) = 'object') AS legacy_left,
           pg_size_pretty(pg_relation_size('inventory_items'))       AS heap,
           pg_size_pretty(pg_total_relation_size('inventory_items')) AS total,
           pg_size_pretty(pg_database_size(current_database()))      AS db
    FROM inventory_items;

`legacy_left` must be 0. Expect heap ~92 MB, total ~138 MB, db ~195 MB.

Then check `pg_index.indisvalid` for the table and drop any `*_ccnew` leftovers —
a failed `REINDEX CONCURRENTLY` leaves an invalid index behind.

## Step 9 — exercise the app

Inventory, a ship's stats, the leaderboard, a public profile, and one gear edit
(which exercises the encode path). Then drop `compact_gear_stats`,
`gear_stat_cell` and `gear_cell_stat`.

## If it goes wrong

- **Reload fails or is short** — `gear-compact.tsv` is intact and the table is
  empty. `TRUNCATE` and reload again. The constraints are still off, so nothing
  else is inconsistent.
- **The dump itself is bad and you have already truncated** — this is what step 3
  exists to prevent. Fall back to `data.sql` from the full backup, which holds
  `COPY "public"."inventory_items"` in the long form; the deployed codec reads
  both shapes, so restoring long-form rows is safe.
- **The site is up but gear is statless** — the deploy did not take. The data is
  fine; ship the client.
