import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reuploadLocalDataToSupabase } from '../../services/userDataService';
import { StorageKey } from '../../constants/storage';
import { getFromIndexedDB } from '../../hooks/useStorage';
import { deletesOn, fakeSupabase } from './fakeSupabase';

const USER = '33333333-3333-4333-8333-333333333333';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({ getFromIndexedDB: vi.fn() }));

const engineering = (stats: unknown[]) => JSON.stringify({ stats });

describe('reuploadLocalDataToSupabase', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    /**
     * engineering_stats holds many rows per user and has no stable per-row identity, so it is
     * replaced wholesale rather than pruned. The replacement has to be gated on the section
     * being READABLE, not on it being non-empty: a user who cleared their engineering stats
     * locally has a present, empty section, and skipping the delete for it leaves the cloud
     * holding stats they removed.
     */
    describe('engineering stats', () => {
        it('clears the cloud rows when the local section is present and empty', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toHaveLength(1);
        });

        it('leaves them alone when the local section is absent', async () => {
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        it('leaves them alone when the local section is unreadable', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, '{ not json');
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        // `readLocalSection`'s non-array branch accepted ANY parsed JSON, so a key holding
        // `null` or a scalar read as present and the replacement then deleted every remote
        // row and inserted nothing.
        it.each([
            ['null', 'null'],
            ['a scalar', '5'],
            ['an object with no stats', '{}'],
        ])('leaves them alone when the local section is %s', async (_label, raw) => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, raw);
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        it('still replaces them when the local section has stats', async () => {
            localStorage.setItem(
                StorageKey.ENGINEERING_STATS,
                engineering([
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 10, type: 'flat' }] },
                ])
            );
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toHaveLength(1);
        });
    });

    // The object sections are read with the same helper. `Object.entries(null)` throws, so a
    // key holding `null` took down the whole upload — every section after it included.
    describe('a malformed object section', () => {
        it('does not abort the upload when the autogear configs are null', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, 'null');
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({});

            await expect(reuploadLocalDataToSupabase(USER)).resolves.toEqual([]);
            // The section AFTER it still ran, which is what aborting would have skipped.
            expect(deletesOn(ops, 'engineering_stats')).toHaveLength(1);
        });
    });

    describe('the sections it reports as incomplete', () => {
        it('reports none when everything lands', async () => {
            fakeSupabase({});

            expect(await reuploadLocalDataToSupabase(USER)).toEqual([]);
        });
    });
});
