import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `inventory_items.stats` has exactly one reader and one writer:
 * `decodeGearStats` and `encodeGearStats`. This is the tripwire for that, keyed
 * to the source of truth — a grep of the repo — rather than to a list somebody
 * has to remember to update.
 *
 * It exists because the encoding change's own design doc listed 7 call sites
 * and there were 11: three duplicate implant-decode blocks and one writer were
 * missing from the hand-written list. A twelfth site added later would silently
 * read or write the wrong shape, and the symptom would be gear quietly losing
 * its stats for whichever page that site feeds.
 */

const SOURCE_ROOT = join(__dirname, '../../..');
const CODEC = 'utils/gear/statsCodec.ts';

const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [relative(SOURCE_ROOT, full)]
            : [];
    });

const sourceFiles = (): string[] => walk(SOURCE_ROOT);

const read = (file: string): string => readFileSync(join(SOURCE_ROOT, file), 'utf8');

describe('inventory_items.stats has a single codec', () => {
    it('finds the source tree — the glob is not silently empty', () => {
        const files = sourceFiles();
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain(CODEC);
    });

    // The long-form keys are the wire format the codec replaced. Outside the
    // codec they can only mean a site building or reading a raw stats payload
    // by hand. `GearPiece.mainStat`/`subStats` are the in-memory domain type and
    // appear everywhere legitimately, so the probe is the two keys TOGETHER in
    // one file that also talks to the inventory table.
    it('no file outside the codec hand-rolls a stats payload for the inventory table', () => {
        const offenders = sourceFiles().filter((file) => {
            if (file === CODEC) return false;
            const source = read(file);
            if (!source.includes('inventory_items')) return false;
            // `stats: {` is an object payload where the wire format is an array;
            // `.stats.mainStat` / `.stats.subStats` reads the raw shape directly.
            return (
                /stats:\s*\{/.test(source) ||
                /\.stats\??\.(mainStat|subStats)/.test(source) ||
                /stats\.(mainStat|subStats)/.test(source)
            );
        });
        expect(offenders).toEqual([]);
    });

    it('every file reading the stats column goes through the codec', () => {
        const unrouted = sourceFiles().filter((file) => {
            if (file === CODEC) return false;
            const source = read(file);
            // Keyed on the column access itself — `inventory_items.stats` — not
            // on a bare `.stats`, which also names engineering stats, refit
            // stats and gear-set stats in files that never touch this column.
            const readsColumn = /inventory_items\??\.stats\b/.test(source);
            const usesCodec = /(encode|decode)GearStats/.test(source);
            return readsColumn && !usesCodec;
        });
        expect(unrouted).toEqual([]);
    });

    it('names the files that are routed, so removing one is a visible diff', () => {
        const routed = sourceFiles()
            .filter((file) => /(encode|decode)GearStats/.test(read(file)))
            .sort();
        expect(routed).toEqual([
            'contexts/InventoryProvider.tsx',
            'pages/database/LeaderboardPage.tsx',
            'services/userDataService.ts',
            'services/userProfileService.ts',
            CODEC,
            'utils/migratePlayerData.ts',
        ]);
    });
});
