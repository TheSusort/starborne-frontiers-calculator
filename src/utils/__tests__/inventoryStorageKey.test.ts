import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `StorageKey.INVENTORY` names an **IndexedDB** entry, profile-scoped, resolved
 * by `inventoryCacheKey(activeProfileId)` in `src/constants/storage.ts`.
 *
 * Passing that constant to anything else reads or writes a place nothing else
 * looks at, and it never throws: `localStorage.getItem` accepts any string and
 * returns `null`, so the symptom is always "gear silently missing" (#504, #511).
 * The compiler cannot see it, so the guard is this test: the constant may only
 * reach the key resolver or an IndexedDB helper, and only in the files below.
 */

const SOURCE_ROOT = join(__dirname, '../..');

/** Files allowed to name the raw constant at all. */
const MENTIONS = [
    'constants/storage.ts',
    'contexts/AuthProvider.tsx',
    'contexts/InventoryProvider.tsx',
    'components/import/BackupRestoreData.tsx',
    'utils/demoData.ts',
    'services/userDataService.ts',
];

/** The only functions the constant may be handed to. */
const ALLOWED_CALLEES = [
    'inventoryCacheKey',
    'getFromIndexedDB',
    'setInIndexedDB',
    'removeFromIndexedDB',
];

// A membership test over section names reads the constant as a name, not as a
// place to read or write, so it is not a storage access.
const MEMBERSHIP_TEST = /\.(has|includes|indexOf)$/;

const MENTION = /StorageKey\.INVENTORY\b/;

// Captures the callee of any call whose first argument is the constant, generic
// type arguments included: `loadLocalData<GearPiece[]>(StorageKey.INVENTORY)`
// is the shape that emptied the migration, and no verb-specific probe sees it.
const CALL_WITH_KEY = /([\w.]+)\s*(?:<[^>()]*>)?\s*\(\s*StorageKey\.INVENTORY\b/g;

const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
            ? [relative(SOURCE_ROOT, full)]
            : [];
    });

const read = (file: string): string => readFileSync(join(SOURCE_ROOT, file), 'utf8');

describe('the inventory storage key stays on IndexedDB', () => {
    it('finds the source tree — the glob is not silently empty', () => {
        const files = walk(SOURCE_ROOT);
        expect(files.length).toBeGreaterThan(100);
        expect(files).toEqual(expect.arrayContaining(MENTIONS));
    });

    it('no file outside the list names the raw inventory key', () => {
        const offenders = walk(SOURCE_ROOT).filter(
            (file) => !MENTIONS.includes(file) && MENTION.test(read(file))
        );
        expect(offenders).toEqual([]);
    });

    it('every listed file still names it, so the list cannot rot into a no-op', () => {
        const inert = MENTIONS.filter((file) => !MENTION.test(read(file)));
        expect(inert).toEqual([]);
    });

    it('hands the key only to the resolver or an IndexedDB helper', () => {
        const offenders = walk(SOURCE_ROOT).flatMap((file) =>
            [...read(file).matchAll(CALL_WITH_KEY)]
                .map(([, callee]) => callee)
                .filter(
                    (callee) => !ALLOWED_CALLEES.includes(callee) && !MEMBERSHIP_TEST.test(callee)
                )
                .map((callee) => `${file}: ${callee}(StorageKey.INVENTORY)`)
        );
        expect(offenders).toEqual([]);
    });
});
