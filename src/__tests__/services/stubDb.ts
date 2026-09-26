import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** One chained call, in the order the code under test made it. */
interface StubCall {
    table: string;
    method: string;
    args: unknown[];
}

export interface StubDbError {
    message: string;
    code?: string;
}

interface StubDbOptions {
    /** Every query on the table resolves with this error. */
    errors?: Record<string, StubDbError>;
    /** The first N queries on the table resolve with an error, later ones succeed. */
    failTimes?: Record<string, number>;
}

/**
 * A minimal chainable stand-in for a `SupabaseClient` handed to code as an argument — the
 * `db` of `src/services/fleetReads.ts` and the MCP tools' `ctx.db`. Unlike `fakeSupabase` it
 * is not wired to the global client, and it EVALUATES the predicates that read path uses —
 * `eq`, `or` over `column.eq.value` terms, `gt`, `order`, `limit` — so a test sees the page a
 * real query returns. The column list passed to `select` is recorded, not projected.
 */
export const stubDb = (tables: Record<string, Row[]>, options: StubDbOptions = {}) => {
    const calls: StubCall[] = [];
    const remainingFailures: Record<string, number> = { ...(options.failTimes ?? {}) };

    const chainFor = (table: string) => {
        let rows: Row[] = [...(tables[table] ?? [])];
        let limit: number | undefined;
        const record = (method: string, args: unknown[]) => calls.push({ table, method, args });

        const failure = (): StubDbError | null => {
            if (options.errors?.[table]) return options.errors[table];
            if ((remainingFailures[table] ?? 0) > 0) {
                remainingFailures[table] -= 1;
                return { message: `${table} is unavailable` };
            }
            return null;
        };

        const settle = () => {
            const error = failure();
            if (error) return { data: null, error };
            return { data: limit === undefined ? rows : rows.slice(0, limit), error: null };
        };

        const chain = {
            select: (...args: unknown[]) => {
                record('select', args);
                return chain;
            },
            eq: (column: string, value: unknown) => {
                record('eq', [column, value]);
                rows = rows.filter((row) => row[column] === value);
                return chain;
            },
            or: (filter: string) => {
                record('or', [filter]);
                const terms = filter.split(',').map((term) => {
                    const [column, operator, ...value] = term.split('.');
                    if (operator !== 'eq') throw new Error(`stubDb: unsupported or() term ${term}`);
                    return { column, value: value.join('.') };
                });
                rows = rows.filter((row) =>
                    terms.some(({ column, value }) => String(row[column]) === value)
                );
                return chain;
            },
            gt: (column: string, value: string) => {
                record('gt', [column, value]);
                rows = rows.filter((row) => String(row[column]) > value);
                return chain;
            },
            order: (column: string) => {
                record('order', [column]);
                rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
                return chain;
            },
            limit: (count: number) => {
                record('limit', [count]);
                limit = count;
                return chain;
            },
            maybeSingle: () => {
                record('maybeSingle', []);
                const result = settle();
                return Promise.resolve(
                    result.error ? result : { data: result.data[0] ?? null, error: null }
                );
            },
            then: <T>(resolve: (result: ReturnType<typeof settle>) => T) =>
                Promise.resolve(settle()).then(resolve),
        };
        return chain;
    };

    const db = {
        from: (table: string) => {
            calls.push({ table, method: 'from', args: [table] });
            return chainFor(table);
        },
    } as unknown as SupabaseClient;

    return { db, calls };
};
