import { vi } from 'vitest';
import { supabase } from '../../config/supabase';

/**
 * A stand-in for the Supabase client that records every statement in the order
 * it was awaited, and serves selects out of a fixed set of cloud rows.
 *
 * A select with no `.range()` is served truncated at `PAGE_SIZE`, the way
 * PostgREST truncates at the project's `db-max-rows`, so a caller that reads
 * ids without paging genuinely sees a prefix.
 *
 * The file that mocks `../../config/supabase` owns that `vi.mock` call; this
 * only installs an implementation on the resulting `supabase.from` mock.
 */

/** Must match ID_PAGE_SIZE in userDataService.ts; asserted by idReadsArePaged.test.ts. */
export const PAGE_SIZE = 1000;

/** Must match BATCH_SIZE in userDataService.ts; asserted by idReadsArePaged.test.ts. */
export const BATCH_SIZE = 500;

/** One equality or membership predicate, in the order it was chained. */
export interface Filter {
    column: string;
    values: unknown[];
    /** True for `.not(column, 'in', …)`: the row matches when it is NOT listed. */
    negated?: boolean;
}

/** One recorded statement, in the order it was actually awaited. */
export interface Op {
    table: string;
    kind: 'select' | 'delete' | 'update' | 'insert' | 'upsert';
    /**
     * The LAST predicate's column and values. Kept because most statements
     * carry exactly one; a statement keyed on a composite identity has to be
     * read off `filters`, which holds every predicate that was chained.
     */
    column?: string;
    values?: unknown[];
    filters?: Filter[];
    payload?: unknown;
    /** The `onConflict` target of an upsert, verbatim. */
    onConflict?: string;
    columns?: string[];
    /** Upper bounds from `.lte(column, value)`, by column. */
    upperBounds?: Record<string, unknown>;
    ordered?: boolean;
    /**
     * Columns handed to `.order()`, in order. A read of a table with no `id`
     * must order by something else, and a test cannot tell unless the fake
     * records which column it was.
     */
    orderedBy?: string[];
    range?: [number, number];
}

/** A child column that points at `parent.id`. */
export interface ForeignKey {
    child: string;
    column: string;
    parent: string;
}

interface FakeSupabaseOptions {
    /**
     * References the fake enforces the way Postgres does: a delete that removes
     * a parent row still pointed at by a live child row resolves with an error
     * instead of succeeding. Declaring any foreign key also makes deletes
     * stateful, so later statements see what earlier ones removed.
     */
    foreignKeys?: ForeignKey[];
}

type Row = Record<string, unknown>;
type Cloud = Record<string, Row[]>;

export const fakeSupabase = (cloud: Cloud, options: FakeSupabaseOptions = {}) => {
    const ops: Op[] = [];
    const foreignKeys = options.foreignKeys ?? [];
    const live: Cloud = Object.fromEntries(
        Object.entries(cloud).map(([table, rows]) => [table, [...rows]])
    );

    /**
     * Every predicate must hold, not just the last one chained: a delete keyed
     * on a composite identity (`user_id` AND `ship_type` AND `stat_name`) would
     * otherwise remove rows Postgres would keep, and a test asserting on the
     * survivors would pass against a delete that is too broad in production.
     */
    const matches = (row: Row, op: Op): boolean => {
        const filters = op.filters ?? [];
        if (filters.length === 0) return false;
        return filters.every(({ column, values, negated }) =>
            negated ? !values.includes(row[column]) : values.includes(row[column])
        );
    };

    /** The error Postgres would raise for `op`, or null if it is legal. */
    const violatedBy = (op: Op): { message: string } | null => {
        const removed = (live[op.table] ?? []).filter((row) => matches(row, op));
        if (removed.length === 0) return null;
        const removedIds = new Set(removed.map((row) => row.id));
        for (const fk of foreignKeys) {
            if (fk.parent !== op.table) continue;
            const orphaned = (live[fk.child] ?? []).filter((row) => removedIds.has(row[fk.column]));
            if (orphaned.length > 0) {
                return {
                    message: `${orphaned.length} ${fk.child} rows still reference ${op.table}`,
                };
            }
        }
        return null;
    };

    const chainFor = (table: string) => {
        const state: Op = { table, kind: 'select' };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
            select: (columns?: string) => {
                state.kind = 'select';
                // Projected, not ignored: a caller that asks for the wrong columns
                // must see rows missing them, or a test cannot tell `'id'` from
                // `'id, ship_id'` and the column string is unverified.
                state.columns = (columns ?? '*')
                    .split(',')
                    .map((column) => column.trim())
                    .filter(Boolean);
                return chain;
            },
            delete: () => {
                state.kind = 'delete';
                return chain;
            },
            update: (payload: unknown) => {
                state.kind = 'update';
                state.payload = payload;
                return chain;
            },
            insert: (payload: unknown) => {
                state.kind = 'insert';
                state.payload = payload;
                return chain;
            },
            upsert: (payload: unknown, options?: { onConflict?: string }) => {
                state.kind = 'upsert';
                state.payload = payload;
                // Recorded so a test can assert the conflict target. An upsert
                // that names the wrong one inserts duplicates or errors in
                // production while looking identical to the right one here.
                state.onConflict = options?.onConflict;
                return chain;
            },
            eq: (column: string, value: unknown) => {
                state.column = column;
                state.values = [value];
                state.filters = [...(state.filters ?? []), { column, values: [value] }];
                return chain;
            },
            in: (column: string, values: unknown[]) => {
                state.column = column;
                state.values = values;
                state.filters = [...(state.filters ?? []), { column, values }];
                return chain;
            },
            not: (column: string, operator: string, value: unknown) => {
                // Only the `in` form is modelled; anything else is recorded as
                // a predicate the fake does not evaluate, the way `lte` is.
                const values =
                    operator === 'in' && typeof value === 'string'
                        ? value
                              .replace(/^\(|\)$/g, '')
                              .split(',')
                              .map((entry) => entry.trim().replace(/^"|"$/g, ''))
                              .filter(Boolean)
                        : [value];
                state.filters = [...(state.filters ?? []), { column, values, negated: true }];
                return chain;
            },
            is: () => chain,
            // PostgREST's `single`: one row or none, never a list. Recorded as the select it
            // is, so a caller that reads a scalar row still shows up in `ops`.
            single: () => ({
                then: (
                    resolve: (r: { data: Row | null; error: { message: string } | null }) => void
                ) => {
                    ops.push({ ...state });
                    const rows = live[table] ?? [];
                    resolve({ data: rows[0] ?? null, error: null });
                },
            }),
            // Recorded, not evaluated: the fake serves rows the way it does for
            // every other predicate, and tests assert on the bound that was sent.
            lte: (column: string, value: unknown) => {
                state.upperBounds = { ...(state.upperBounds ?? {}), [column]: value };
                return chain;
            },
            order: (column?: string) => {
                state.ordered = true;
                if (column !== undefined) {
                    state.orderedBy = [...(state.orderedBy ?? []), column];
                }
                return chain;
            },
            // Serves the slice the caller asked for, so a helper that reads only
            // the first page genuinely sees a truncated list.
            range: (from: number, to: number) => {
                state.range = [from, to];
                return chain;
            },
            then: (
                resolve: (r: { data: Row[] | null; error: { message: string } | null }) => void
            ) => {
                ops.push({ ...state });
                if (state.kind === 'delete' && foreignKeys.length > 0) {
                    const error = violatedBy(state);
                    if (error) {
                        resolve({ data: null, error });
                        return;
                    }
                    live[state.table] = (live[state.table] ?? []).filter(
                        (row) => !matches(row, state)
                    );
                }
                if (state.kind !== 'select') {
                    resolve({ data: null, error: null });
                    return;
                }
                const rows = live[table] ?? [];
                const page = state.range
                    ? rows.slice(state.range[0], state.range[1] + 1)
                    : rows.slice(0, PAGE_SIZE);
                const columns = state.columns;
                const projected =
                    !columns || columns.includes('*')
                        ? page
                        : page.map((row) =>
                              Object.fromEntries(
                                  columns
                                      .filter((column) => column in row)
                                      .map((column) => [column, row[column]])
                              )
                          );
                resolve({ data: projected, error: null });
            },
        };
        return chain;
    };

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
        chainFor(table)
    );
    return ops;
};

export const deletesOn = (ops: Op[], table: string) =>
    ops.filter((op) => op.table === table && op.kind === 'delete');

export const indexOfDelete = (ops: Op[], table: string) =>
    ops.findIndex((op) => op.table === table && op.kind === 'delete');

/** Every value handed to a delete on `table`, across all of its batches. */
export const deletedValues = (ops: Op[], table: string) =>
    deletesOn(ops, table).flatMap((op) => op.values ?? []);

/** Every upsert issued against `table`, in the order they were awaited. */
export const upsertsOn = (ops: Op[], table: string) =>
    ops.filter((op) => op.table === table && op.kind === 'upsert');
