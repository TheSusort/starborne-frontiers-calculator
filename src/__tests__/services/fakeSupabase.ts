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

/** One recorded statement, in the order it was actually awaited. */
export interface Op {
    table: string;
    kind: 'select' | 'delete' | 'update';
    column?: string;
    values?: unknown[];
    payload?: unknown;
    ordered?: boolean;
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

    const matches = (row: Row, op: Op): boolean =>
        op.column !== undefined && (op.values ?? []).includes(row[op.column]);

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
            select: () => {
                state.kind = 'select';
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
            eq: (column: string, value: unknown) => {
                state.column = column;
                state.values = [value];
                return chain;
            },
            in: (column: string, values: unknown[]) => {
                state.column = column;
                state.values = values;
                return chain;
            },
            not: () => chain,
            is: () => chain,
            order: () => {
                state.ordered = true;
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
                resolve({ data: page, error: null });
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
