import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `statsCodecCallSites.test.ts` closes the set of files that READ or build an
 * `inventory_items.stats` payload. It is keyed on the column name, so it is
 * blind to a file that inserts into the table without ever naming `.stats` —
 * exactly the shape that emptied cloud gear in #504, where a raw spread of the
 * localStorage `GearPiece` reached `.insert()` and PostgREST rejected it.
 *
 * This closes the complementary set: who may WRITE the table at all. A new
 * writer is a decision, not an accident — it must build the column shape and
 * route stats through the codec, so adding one means updating this list.
 */

const SOURCE_ROOT = join(__dirname, '../../..');

const WRITERS = [
    'contexts/InventoryProvider.tsx',
    'services/userDataService.ts',
    'utils/migratePlayerData.ts',
];

const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [relative(SOURCE_ROOT, full)]
            : [];
    });

const read = (file: string): string => readFileSync(join(SOURCE_ROOT, file), 'utf8');

// `.from('inventory_items')` and the write call are on separate lines in every
// existing site, so the probe spans whitespace rather than matching one line.
const WRITE_CALL = /\.from\(\s*['"]inventory_items['"]\s*\)[\s\S]{0,200}?\.\s*(insert|upsert)\s*\(/;

describe('inventory_items has a closed set of writers', () => {
    it('finds the source tree — the glob is not silently empty', () => {
        const files = walk(SOURCE_ROOT);
        expect(files.length).toBeGreaterThan(100);
        expect(files).toEqual(expect.arrayContaining(WRITERS));
    });

    it('no file outside the writer set inserts or upserts into the table', () => {
        const offenders = walk(SOURCE_ROOT).filter(
            (file) => !WRITERS.includes(file) && WRITE_CALL.test(read(file))
        );
        expect(offenders).toEqual([]);
    });

    it('every named writer still writes, so the list cannot rot into a no-op', () => {
        const inert = WRITERS.filter((file) => !WRITE_CALL.test(read(file)));
        expect(inert).toEqual([]);
    });
});
