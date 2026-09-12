import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, PAGE_SIZE } from './fakeSupabase';

/**
 * PostgREST truncates any response at the project's `db-max-rows`, so an id read
 * that does not page returns a prefix. `readAllIds` in userDataService.ts is the
 * one place that pages; its doc comment carries the rule.
 *
 * A new unpaged id read in this file is invisible in review — it looks like
 * every other select. This scans the source so the next one fails the suite
 * instead.
 */

const SERVICE = join(__dirname, '../../services/userDataService.ts');

/** Leading dot, so the `select('id')` inside a doc comment is not a match. */
const ID_READ = /\.select\(\s*['"]id\b/g;

/**
 * Character span of `readAllIds`' body, by brace counting. A span that runs to
 * the end of the file would swallow every later read, which is what the
 * positive control below catches.
 */
const readAllIdsBody = (source: string): [number, number] => {
    const signature = source.indexOf('async function readAllIds(');
    if (signature < 0) throw new Error('readAllIds not found in userDataService.ts');
    const open = source.indexOf('{', source.indexOf(')', signature));
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return [open, i];
    }
    throw new Error('readAllIds body is unbalanced');
};

/** 1-based line numbers of id reads that sit outside `readAllIds`. */
const unpagedIdReads = (source: string): number[] => {
    const [start, end] = readAllIdsBody(source);
    const lines: number[] = [];
    for (const match of source.matchAll(ID_READ)) {
        const at = match.index ?? 0;
        if (at >= start && at <= end) continue;
        lines.push(source.slice(0, at).split('\n').length);
    }
    return lines;
};

describe('every id read in userDataService goes through readAllIds', () => {
    const source = readFileSync(SERVICE, 'utf8');

    it('found the paging helper, not an empty span', () => {
        const [start, end] = readAllIdsBody(source);
        const body = source.slice(start, end);
        expect(body).toContain('.range(');
        expect(body).toContain('.order(');
        expect(body).toMatch(ID_READ);
    });

    it('matches the id reads this file actually contains', () => {
        expect(source.match(ID_READ)?.length ?? 0).toBeGreaterThan(0);
    });

    it('reports an id read added outside the helper', () => {
        const mutated = `${source}\nconst leak = supabase.from('ships').select('id');\n`;
        const injected = source.split('\n').length + 1;
        expect(unpagedIdReads(mutated)).toEqual([...unpagedIdReads(source), injected]);
    });

    it('finds no unpaged id read in the service', () => {
        expect(unpagedIdReads(source)).toEqual([]);
    });

    // The fake serves selects in pages of PAGE_SIZE and asserts delete batch
    // sizes; both are meaningless if the service moved off these numbers.
    it('pages and batches at the sizes the service tests assume', () => {
        expect(source).toContain(`const ID_PAGE_SIZE = ${PAGE_SIZE};`);
        expect(source).toContain(`const BATCH_SIZE = ${BATCH_SIZE};`);
    });
});
