import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reuploadLocalDataToSupabase } from '../../services/userDataService';
import { StorageKey } from '../../constants/storage';
import { getFromIndexedDB } from '../../hooks/useStorage';
import { deletesOn, fakeSupabase, upsertsOn } from './fakeSupabase';

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
     * The section is written with an upsert on `(user_id, ship_type, stat_name)`, the table's
     * primary key. Nothing here removes a row: a stat the local section no longer names is
     * `pruneSupabaseDataNotInLocal`'s job, so a rejected write can never leave the user with
     * neither their cloud stats nor a replacement.
     */
    describe('engineering stats', () => {
        it('upserts the local stats on their composite key', async () => {
            localStorage.setItem(
                StorageKey.ENGINEERING_STATS,
                engineering([
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 10, type: 'flat' }] },
                ])
            );
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            const upserts = upsertsOn(ops, 'engineering_stats');
            expect(upserts).toHaveLength(1);
            expect(upserts[0].onConflict).toBe('user_id,ship_type,stat_name');
            expect(upserts[0].payload).toEqual([
                {
                    user_id: USER,
                    ship_type: 'ATTACKER',
                    stat_name: 'attack',
                    value: 10,
                    type: 'flat',
                },
            ]);
        });

        it('issues no delete on the table', async () => {
            localStorage.setItem(
                StorageKey.ENGINEERING_STATS,
                engineering([
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 10, type: 'flat' }] },
                ])
            );
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        it.each([
            ['present and empty', engineering([])],
            ['absent', null],
            ['unreadable', '{ not json'],
            ['null', 'null'],
            ['an object with no stats', '{}'],
        ])('writes nothing when the local section is %s', async (_label, raw) => {
            if (raw !== null) localStorage.setItem(StorageKey.ENGINEERING_STATS, raw);
            const ops = fakeSupabase({});

            await reuploadLocalDataToSupabase(USER);

            expect(ops.filter((op) => op.table === 'engineering_stats')).toEqual([]);
        });
    });

    // The object sections are read with the same helper. `Object.entries(null)` throws, so a
    // key holding `null` took down the whole upload — every section after it included.
    describe('a malformed object section', () => {
        it('does not abort the upload when the autogear configs are null', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, 'null');
            localStorage.setItem(
                StorageKey.ENGINEERING_STATS,
                engineering([
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 10, type: 'flat' }] },
                ])
            );
            const ops = fakeSupabase({});

            await expect(reuploadLocalDataToSupabase(USER)).resolves.toEqual([]);
            // The section AFTER it still ran, which is what aborting would have skipped.
            expect(upsertsOn(ops, 'engineering_stats')).toHaveLength(1);
        });
    });

    describe('the sections it reports as incomplete', () => {
        it('reports none when everything lands', async () => {
            fakeSupabase({});

            expect(await reuploadLocalDataToSupabase(USER)).toEqual([]);
        });
    });
});
