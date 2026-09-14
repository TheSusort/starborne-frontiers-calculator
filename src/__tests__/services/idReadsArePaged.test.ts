import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, PAGE_SIZE } from './fakeSupabase';

/**
 * PostgREST truncates any response at the project's `db-max-rows`, so a read
 * that does not page returns a prefix. `readAllRows` in userDataService.ts is
 * the one place that pages; its doc comment carries the rule.
 *
 * A new unpaged read in this file is invisible in review — it looks like every
 * other select. This scans the source so the next one fails the suite instead.
 *
 * The scan matches EVERY `.select(`, not only `.select('id`: the prune of
 * `autogear_configs` reads `(id, ship_id)`, and a column name that merely
 * starts with something other than `id` is not a reason to skip paging.
 */

const SERVICE = join(__dirname, '../../services/userDataService.ts');

/** Leading dot, so a `select(...)` written in prose in a doc comment is not a match. */
const ROW_READ = /\.select\(/g;

/** The function whose body is allowed to hold an unpaged-looking select. */
const PAGER = 'async function readAllRows<T>(';

/**
 * Character span of the pager's body, by brace counting. A span that runs to
 * the end of the file would swallow every later read, which is what the
 * positive control below catches.
 */
const pagerBody = (source: string): [number, number] => {
    const signature = source.indexOf(PAGER);
    if (signature < 0) throw new Error(`${PAGER} not found in userDataService.ts`);
    const open = source.indexOf('{', source.indexOf(')', signature));
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return [open, i];
    }
    throw new Error('the pager body is unbalanced');
};

/** 1-based line numbers of reads that sit outside the pager. */
const unpagedReads = (source: string): number[] => {
    const [start, end] = pagerBody(source);
    const lines: number[] = [];
    for (const match of source.matchAll(ROW_READ)) {
        const at = match.index ?? 0;
        if (at >= start && at <= end) continue;
        lines.push(source.slice(0, at).split('\n').length);
    }
    return lines;
};

describe('every row read in userDataService goes through readAllRows', () => {
    const source = readFileSync(SERVICE, 'utf8');

    it('found the paging helper, not an empty span', () => {
        const [start, end] = pagerBody(source);
        const body = source.slice(start, end);
        expect(body).toContain('.range(');
        expect(body).toContain('.order(');
        expect(body).toMatch(ROW_READ);
    });

    it('matches the reads this file actually contains', () => {
        expect(source.match(ROW_READ)?.length ?? 0).toBeGreaterThan(0);
    });

    it('reports a read added outside the helper', () => {
        const mutated = `${source}\nconst leak = supabase.from('ships').select('id');\n`;
        const injected = source.split('\n').length + 1;
        expect(unpagedReads(mutated)).toEqual([...unpagedReads(source), injected]);
    });

    // The read the old `.select('id` scan was blind to: `ship_id` does not start
    // with `id`, so a bare one looked like nothing at all.
    it('reports a read of a column whose name does not start with id', () => {
        const mutated = `${source}\nconst leak = supabase.from('autogear_configs').select('ship_id');\n`;
        const injected = source.split('\n').length + 1;
        expect(unpagedReads(mutated)).toEqual([...unpagedReads(source), injected]);
    });

    it('finds no unpaged read in the service', () => {
        expect(unpagedReads(source)).toEqual([]);
    });

    // The fake serves selects in pages of PAGE_SIZE and asserts delete batch
    // sizes; both are meaningless if the service moved off these numbers.
    it('pages and batches at the sizes the service tests assume', () => {
        expect(source).toContain(`const ID_PAGE_SIZE = ${PAGE_SIZE};`);
        expect(source).toContain(`const BATCH_SIZE = ${BATCH_SIZE};`);
    });
});
