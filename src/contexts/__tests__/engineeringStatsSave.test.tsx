import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { supabase } from '../../config/supabase';
import { EngineeringStatsProvider, useEngineeringStats } from '../EngineeringStatsProvider';
import { fakeSupabase, type Op } from '../../__tests__/services/fakeSupabase';
import type { EngineeringStats } from '../../types/stats';

const { notify, USER } = vi.hoisted(() => ({
    notify: vi.fn(),
    USER: '33333333-3333-4333-8333-333333333333',
}));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: notify }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: USER, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));

type Row = Record<string, unknown>;

/** The cloud every test starts from: two stats on one ship type, one on another. */
const seeded = (): Row[] => [
    { user_id: USER, ship_type: 'ATTACKER', stat_name: 'attack', value: 10, type: 'percentage' },
    { user_id: USER, ship_type: 'ATTACKER', stat_name: 'crit', value: 5, type: 'percentage' },
    { user_id: USER, ship_type: 'DEFENDER', stat_name: 'hp', value: 100, type: 'flat' },
];

const identity = (row: Row) => `${row.ship_type as string}/${row.stat_name as string}`;

/**
 * The real `engineering_stats.user_id` reference. Declaring it makes the fake's
 * deletes stateful, so a later select reports which rows a save actually removed.
 */
const FOREIGN_KEYS = [{ child: 'engineering_stats', column: 'user_id', parent: 'users' }];

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <EngineeringStatsProvider>{children}</EngineeringStatsProvider>
);

/** Mounts the provider over `rows` and waits for its initial cloud load to land. */
const mountOver = async (rows: Row[] = seeded()) => {
    const ops = fakeSupabase({ engineering_stats: rows }, { foreignKeys: FOREIGN_KEYS });
    const view = renderHook(() => useEngineeringStats(), { wrapper });
    await waitFor(() => expect(view.result.current.engineeringStats.stats.length).toBe(2));
    return { ops, view };
};

/** The rows the cloud still holds, read through the fake's stateful store. */
const liveIdentities = async (): Promise<string[]> => {
    const { data } = await supabase.from('engineering_stats').select('*').eq('user_id', USER);
    return ((data ?? []) as Row[]).map(identity);
};

const engineeringOps = (ops: Op[]) => ops.filter((op) => op.table === 'engineering_stats');

/** Makes every upsert resolve with an error, the way a rejected write does. */
const rejectUpserts = () => {
    const from = supabase.from as unknown as ReturnType<typeof vi.fn>;
    const served = from.getMockImplementation() as (table: string) => Record<string, unknown>;
    from.mockImplementation((table: string) => ({
        ...served(table),
        upsert: () => ({
            then: (resolve: (result: { data: null; error: { message: string } }) => void) =>
                resolve({ data: null, error: { message: 'upsert rejected' } }),
        }),
    }));
};

describe('saveEngineeringStats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('upserts on the composite key before it deletes anything', async () => {
        const { ops, view } = await mountOver();

        await act(async () => {
            await view.result.current.saveEngineeringStats({
                stats: [
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 20, type: 'flat' }] },
                ],
            });
        });

        const engineering = engineeringOps(ops);
        const upsertAt = engineering.findIndex((op) => op.kind === 'upsert');
        const deleteAt = engineering.findIndex((op) => op.kind === 'delete');
        expect(upsertAt).toBeGreaterThanOrEqual(0);
        expect(deleteAt).toBeGreaterThanOrEqual(0);
        expect(upsertAt).toBeLessThan(deleteAt);
        expect(engineering[upsertAt].onConflict).toBe('user_id,ship_type,stat_name');
        expect(engineering.some((op) => op.kind === 'insert')).toBe(false);
        expect(notify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('deletes a stat name the saved ship type no longer carries', async () => {
        const { view } = await mountOver();

        await act(async () => {
            await view.result.current.saveEngineeringStats({
                stats: [
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 20, type: 'flat' }] },
                ],
            });
        });

        expect(await liveIdentities()).toEqual(['ATTACKER/attack', 'DEFENDER/hp']);
    });

    it('leaves a ship type the save does not mention alone', async () => {
        const { ops, view } = await mountOver();

        await act(async () => {
            await view.result.current.saveEngineeringStats({
                stats: [
                    { shipType: 'ATTACKER', stats: [{ name: 'attack', value: 20, type: 'flat' }] },
                ],
            });
        });

        expect(await liveIdentities()).toContain('DEFENDER/hp');
        for (const op of engineeringOps(ops).filter((candidate) => candidate.kind === 'delete')) {
            expect(op.filters).toContainEqual({ column: 'ship_type', values: ['ATTACKER'] });
        }
    });

    it('deletes every row of a saved ship type that carries no stats', async () => {
        const { ops, view } = await mountOver();

        await act(async () => {
            await view.result.current.saveEngineeringStats({
                stats: [{ shipType: 'ATTACKER', stats: [] }],
            });
        });

        expect(await liveIdentities()).toEqual(['DEFENDER/hp']);

        // `not in ()` is not valid PostgREST, so the empty-stat-list delete must carry
        // no `stat_name` predicate at all. The fake treats an empty negated list as
        // "matches every row", so only the filter list separates the two branches.
        const deletes = engineeringOps(ops).filter((op) => op.kind === 'delete');
        expect(deletes).toHaveLength(1);
        expect(deletes[0].filters).toEqual([
            { column: 'user_id', values: [USER] },
            { column: 'ship_type', values: ['ATTACKER'] },
        ]);
    });

    it('leaves the cloud untouched and rolls back when the upsert is rejected', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { ops, view } = await mountOver();
        const loaded: EngineeringStats = JSON.parse(
            JSON.stringify(view.result.current.engineeringStats)
        );
        const payload: EngineeringStats = {
            stats: [{ shipType: 'ATTACKER', stats: [{ name: 'attack', value: 99, type: 'flat' }] }],
        };
        expect(loaded).not.toEqual(payload);

        rejectUpserts();
        await act(async () => {
            await expect(view.result.current.saveEngineeringStats(payload)).rejects.toBeTruthy();
        });

        expect(view.result.current.engineeringStats).toEqual(loaded);
        expect(engineeringOps(ops).filter((op) => op.kind === 'delete')).toHaveLength(0);
        expect(await liveIdentities()).toEqual(seeded().map(identity));
        expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    });
});
