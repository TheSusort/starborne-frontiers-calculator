# Shrinking the `inventory_items` file after the compact-stats migration

> **EXECUTED 2026-09-09 and it worked.** `pg_database_size` 382 → **205 MB**,
> dashboard ~415 → **~223 MB**, heap 273 → 96 MB, indexes 51 MB. The row
> fingerprint (`sum(hashtext(i::text))` = 486557030870) matched exactly across
> the swap and all four FK re-adds succeeded. Gear was absent for **34
> seconds**, not the 1–3 minutes estimated below.
>
> Two things to carry into any repeat, both learned the hard way here:
> a reload leaves indexes fatter than a rebuild does (they came back at 66 MB
> and a `REINDEX CONCURRENTLY` recovered 15 MB), and `TRUNCATE` must be in
> autocommit or the whole exercise is pointless.

The rows are **already compact** — the batched `UPDATE` in
`compact-gear-stats.sql` ran against production on 2026-09-09 and all 655,402
rows are in the array form. This runbook is now only about the **file**, which
an `UPDATE` never shrinks.

Where things stand, measured 2026-09-09 after the migration and a full reindex:

| | bytes |
| --- | --- |
| heap file | 273 MB |
| heap **live** | 109 MB |
| indexes (freshly rebuilt) | 51 MB |
| `pg_database_size` | 382 MB |
| dashboard (`× 1.085`) | ~415 MB |

So 164 MB of the heap file is free space that new rows will reuse but the quota
still counts. `TRUNCATE` unlinks the file; that is the only cheap mechanism that
returns it. Expected outcome:

| | now | after this |
| --- | --- | --- |
| `inventory_items` total | 324 MB | **~160 MB** |
| `pg_database_size` | 382 MB | **~218 MB** |
| dashboard | ~415 MB | **~237 MB** |
| peak during | — | ~221 MB |

The peak is *below* the finish line, because `TRUNCATE` frees all 324 MB before
the reload puts back 160 MB. This is much safer than when this runbook was first
written, when live bytes were 254 MB and the peak ran close to the quota.

**`VACUUM FULL` is still unavailable** and re-checking it after the reindex does
not change that: it holds the old and new copies at once, so the peak is
382 + ~160 = ~545 MB, past the 500 MB quota → the project goes read-only.

## What this costs

**Gear data does not exist in production between `TRUNCATE` and the end of the
reload** — roughly 1–3 minutes for 655k rows. Anyone loading the site in that
window sees an empty inventory, and a client that syncs during it can write
gear that the reload then overwrites. There is no maintenance mode in this app,
so pick a quiet hour. If the reload fails, gear stays empty until you rerun it,
which is what step 2's verification exists to prevent.

If that window is not acceptable, stop here: the migration already did the part
that matters for growth (174 B/row instead of 388 B/row, and 164 MB of reusable
headroom). This step only moves the dashboard number.

## Connection

**`psql`, not the SQL editor.** Supabase exposes no server filesystem, so
`COPY TO '/path'` is unavailable — this is `\copy`, which streams client-side.
The editor also wraps submissions in a transaction, and a transactional
`TRUNCATE` defeats the whole point: the old file is only unlinked at `COMMIT`,
so both copies exist during the reload and the peak becomes 382 + 160 = 542 MB.
Run it in autocommit.

**Use the pooler in session mode (port 5432), not the direct host.** The
earlier instruction to use the direct string was wrong: `db.<ref>.supabase.co`
publishes only an AAAA record and is unreachable without IPv6 egress. Session
mode is a 1:1 proxy and supports `\copy`, `TRUNCATE`, `VACUUM` and `REINDEX`.
Transaction mode (6543) does not.

`scratchpad/pg.sh` from the migration session does this: it splits
`SUPABASE_DB_URL` into `PG*` variables so the password never lands in `argv`,
takes host and tenant-qualified user from `supabase/.temp/pooler-url`, and
forces `PGPORT=5432`.

## Step 0 — capture what you must restore, and a checksum

    -- the four inbound FKs, with their EXACT definitions
    SELECT conname, conrelid::regclass AS child, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE confrelid = 'public.inventory_items'::regclass AND contype = 'f'
    ORDER BY conname;

    -- baseline to compare against at the end: order-independent, all columns
    SELECT count(*) AS rows,
           sum(hashtext(i::text))::bigint AS row_hash_sum,
           count(DISTINCT user_id) AS distinct_users
    FROM public.inventory_items i;

    -- dependent counts, which must be identical at the end
    SELECT (SELECT count(*) FROM public.ship_equipment)         AS ship_equipment,
           (SELECT count(*) FROM public.ship_implants)          AS ship_implants,
           (SELECT count(*) FROM public.loadout_equipment)      AS loadout_equipment,
           (SELECT count(*) FROM public.team_loadout_equipment) AS team_loadout_equipment;

Write all of it down outside the terminal. `row_hash_sum` is the thing that
proves the reload was faithful rather than merely complete.

## Step 1 — dump

No re-encoding: the rows are already compact, and the three helper functions
(`compact_gear_stats`, `gear_stat_cell`, `gear_cell_stat`) have been dropped.
The older version of this step referenced `compact_gear_stats` and would now
fail with `function ... does not exist`.

    \copy (SELECT id, user_id, calibration_ship_id, slot, rarity, set_bonus,
                  level, stars, created_at, updated_at, stats
           FROM public.inventory_items)
      TO 'gear-compact.tsv'

Keep that column order — step 3 depends on it. The file lands wherever you ran
`psql`; `/*.sql` and `data.sql` are gitignored at the repo root but
`gear-compact.tsv` is **not**, so write it outside the repo.

## Step 2 — VERIFY THE DUMP. Do not skip.

For the next few minutes this file is the only copy of every user's gear.

    $ wc -l gear-compact.tsv                 # must equal the count from step 0
    $ head -2 gear-compact.tsv               # stats column reads like ["a60","k6"]
    $ grep -c mainStat gear-compact.tsv      # must be 0
    $ grep -cP '\t\\N\t' gear-compact.tsv    # nulls present is fine, just look

A count mismatch means stop. An empty or truncated file means stop.

## Step 3 — drop the four FKs, truncate, reload

`TRUNCATE` is refused while any inbound FK exists, **even when the child tables
are empty** — it is the constraint that blocks it, not the data. Do not reach
for `TRUNCATE ... CASCADE`: it would empty all four children plus
`ship_implant_stats`.

    ALTER TABLE ship_equipment         DROP CONSTRAINT ship_equipment_new_gear_id_fkey;
    ALTER TABLE loadout_equipment      DROP CONSTRAINT loadout_equipment_new_gear_id_fkey;
    ALTER TABLE team_loadout_equipment DROP CONSTRAINT team_loadout_equipment_new_gear_id_fkey;
    ALTER TABLE ship_implants          DROP CONSTRAINT ship_implants_id_fkey;

    TRUNCATE public.inventory_items;
    \copy public.inventory_items (id, user_id, calibration_ship_id, slot, rarity, set_bonus, level, stars, created_at, updated_at, stats) FROM 'gear-compact.tsv'

RLS policies, indexes, the `'[""]'` default and grants all survive — `TRUNCATE`
replaces the file, not the table. That is the main reason to prefer it over
`CREATE TABLE AS` + rename, which copies none of them and would leave you
rebuilding RLS on the most sensitive table in the schema.

## Step 4 — verify before restoring the constraints

    SELECT count(*) AS rows,
           sum(hashtext(i::text))::bigint AS row_hash_sum,
           count(DISTINCT user_id) AS distinct_users,
           count(*) FILTER (WHERE jsonb_typeof(stats) <> 'array') AS not_array
    FROM public.inventory_items i;

All four must match step 0, and `not_array` must be 0. If `row_hash_sum`
differs while the count matches, a column was reordered or a value mangled —
`TRUNCATE` and reload again rather than proceeding.

## Step 5 — restore the four FKs

Reverse of step 3, using the definitions captured in step 0. **The re-add is
itself a completeness check**: if the reload lost a row a child still
references, Postgres refuses with

    ERROR: insert or update on table "ship_equipment" violates foreign key constraint
    DETAIL: Key (gear_id)=(...) is not present in table "inventory_items".

so a lossy reload cannot pass silently. If that fires, the dump is still on
disk — diagnose before doing anything else.

## Step 6 — settle and measure

    VACUUM ANALYZE public.inventory_items;

    SELECT pg_size_pretty(pg_relation_size('public.inventory_items'))       AS heap,
           pg_size_pretty(pg_indexes_size('public.inventory_items'))        AS idx,
           pg_size_pretty(pg_total_relation_size('public.inventory_items')) AS total,
           pg_database_size(current_database()) / 1048576                   AS db_mb,
           round(pg_database_size(current_database()) * 1.085 / 1048576)     AS dashboard_est_mb;

Measured on the 2026-09-09 run: heap 96 MB, idx 51 MB, total 147 MB, db
205 MB, dashboard ~223 MB.

**Reindex after the reload.** The opposite of what an earlier draft of this
file claimed: index entries are built as the rows arrive rather than
bulk-sorted, so they pack *less* densely than a rebuild. They came back at
66 MB against the 51 MB held before the swap, and this recovered the 15 MB in
about 25 seconds:

    REINDEX INDEX CONCURRENTLY public.idx_inventory_items_user_id_id;
    REINDEX INDEX CONCURRENTLY public.inventory_items_pkey;

Then check for invalid leftovers:

    SELECT indexrelid::regclass FROM pg_index
    WHERE indrelid = 'public.inventory_items'::regclass AND NOT indisvalid;

## Step 7 — exercise the app

Inventory, one ship's stats, the leaderboard, a public profile, and one gear
edit — the edit is the only one of these that exercises the **encode** path.

## If it goes wrong

- **Reload fails or is short** — `gear-compact.tsv` is intact and the table is
  empty. `TRUNCATE` and reload again. The FKs are still off, so nothing else is
  inconsistent yet.
- **The dump is bad and you have already truncated** — this is what step 2
  exists to prevent. Fall back to `data.sql` from the 2026-09-09 full backup,
  which holds `COPY "public"."inventory_items"` in the **long form**. The
  deployed codec reads both shapes, so restoring long-form rows is safe and
  correct; you would simply be back to needing the batched `UPDATE`.
- **Site is up but gear reads statless** — that is a client problem, not a data
  one. The array branch of `decodeGearStats` is live and verified; check the
  deploy.
