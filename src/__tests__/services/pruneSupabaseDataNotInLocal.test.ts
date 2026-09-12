import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pruneSupabaseDataNotInLocal } from '../../services/userDataService';
import { StorageKey, inventoryCacheKey } from '../../constants/storage';
import { supabase } from '../../config/supabase';
import { getFromIndexedDB } from '../../hooks/useStorage';

const USER = '22222222-2222-4222-8222-222222222222';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({ getFromIndexedDB: vi.fn() }));

/** One recorded statement, in the order it was actually awaited. */
interface Op {
    table: string;
    kind: 'select' | 'delete' | 'update';
    column?: string;
    values?: unknown[];
    payload?: unknown;
}

/**
 * Records every statement in execution order against a fixed set of cloud rows.
 * Ordering is the property under test: a parent deleted before its children
 * violates an FK, and the prune must never be the thing that loses data.
 */
const fakeSupabase = (cloud: Record<string, Array<Record<string, unknown>>>) => {
    const ops: Op[] = [];

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
            then: (
                resolve: (r: { data: Array<Record<string, unknown>> | null; error: null }) => void
            ) => {
                ops.push({ ...state });
                resolve({
                    data: state.kind === 'select' ? (cloud[table] ?? []) : null,
                    error: null,
                });
            },
        };
        return chain;
    };

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
        chainFor(table)
    );
    return ops;
};

const deletesOn = (ops: Op[], table: string) =>
    ops.filter((op) => op.table === table && op.kind === 'delete');

const indexOfDelete = (ops: Op[], table: string) =>
    ops.findIndex((op) => op.table === table && op.kind === 'delete');

describe('pruneSupabaseDataNotInLocal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    it('deletes only the cloud ships that the local snapshot does not have', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([{ id: 'keep-ship' }]));
        const ops = fakeSupabase({ ships: [{ id: 'keep-ship' }, { id: 'stale-ship' }] });

        await pruneSupabaseDataNotInLocal(USER);

        const shipDeletes = deletesOn(ops, 'ships');
        expect(shipDeletes).toHaveLength(1);
        expect(shipDeletes[0].values).toEqual(['stale-ship']);
    });

    it('deletes only the cloud gear that the local snapshot does not have', async () => {
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
            Promise.resolve(key === inventoryCacheKey(USER) ? [{ id: 'keep-gear' }] : [])
        );
        const ops = fakeSupabase({
            inventory_items: [{ id: 'keep-gear' }, { id: 'stale-gear' }],
        });

        await pruneSupabaseDataNotInLocal(USER);

        const gearDeletes = deletesOn(ops, 'inventory_items');
        expect(gearDeletes).toHaveLength(1);
        expect(gearDeletes[0].values).toEqual(['stale-gear']);
    });

    it('deletes only the cloud encounter notes that the local snapshot does not have', async () => {
        localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify([{ id: 'keep-note' }]));
        const ops = fakeSupabase({ encounter_notes: [{ id: 'keep-note' }, { id: 'stale-note' }] });

        await pruneSupabaseDataNotInLocal(USER);

        const noteDeletes = deletesOn(ops, 'encounter_notes');
        expect(noteDeletes).toHaveLength(1);
        expect(noteDeletes[0].values).toEqual(['stale-note']);
    });

    it('issues no delete at all when the cloud holds nothing the local snapshot lacks', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([{ id: 'a' }]));
        localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify([{ id: 'n' }]));
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'g' }]);
        const ops = fakeSupabase({
            ships: [{ id: 'a' }],
            inventory_items: [{ id: 'g' }],
            encounter_notes: [{ id: 'n' }],
        });

        await pruneSupabaseDataNotInLocal(USER);

        expect(ops.filter((op) => op.kind === 'delete')).toEqual([]);
    });

    it('clears calibration pointing at a stale ship before deleting that ship', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const ops = fakeSupabase({ ships: [{ id: 'stale-ship' }] });

        await pruneSupabaseDataNotInLocal(USER);

        const clear = ops.findIndex((op) => op.table === 'inventory_items' && op.kind === 'update');
        expect(clear).toBeGreaterThanOrEqual(0);
        expect(ops[clear].payload).toEqual({ calibration_ship_id: null });
        expect(clear).toBeLessThan(indexOfDelete(ops, 'ships'));
    });

    it('deletes every ship child row before the ship row itself', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const ops = fakeSupabase({
            ships: [{ id: 'stale-ship' }],
            ship_implants: [{ id: 'imp-1' }],
            ship_refits: [{ id: 'ref-1' }],
        });

        await pruneSupabaseDataNotInLocal(USER);

        const shipDelete = indexOfDelete(ops, 'ships');
        for (const child of [
            'ship_equipment',
            'ship_implant_stats',
            'ship_implants',
            'ship_refit_stats',
            'ship_refits',
            'ship_base_stats',
            'encounter_formations',
        ]) {
            const at = indexOfDelete(ops, child);
            expect(at, `${child} must be deleted before ships`).toBeGreaterThanOrEqual(0);
            expect(at, `${child} must be deleted before ships`).toBeLessThan(shipDelete);
        }
    });

    it('removes references to stale gear before deleting the gear row', async () => {
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const ops = fakeSupabase({ inventory_items: [{ id: 'stale-gear' }] });

        await pruneSupabaseDataNotInLocal(USER);

        const gearDelete = indexOfDelete(ops, 'inventory_items');
        for (const child of [
            'ship_equipment',
            'ship_implants',
            'loadout_equipment',
            'team_loadout_equipment',
        ]) {
            const at = indexOfDelete(ops, child);
            expect(at, `${child} must be cleared before inventory_items`).toBeGreaterThanOrEqual(0);
            expect(at, `${child} must be cleared before inventory_items`).toBeLessThan(gearDelete);
        }
    });

    it('deletes encounter children before the note row', async () => {
        localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify([]));
        const ops = fakeSupabase({ encounter_notes: [{ id: 'stale-note' }] });

        await pruneSupabaseDataNotInLocal(USER);

        const noteDelete = indexOfDelete(ops, 'encounter_notes');
        for (const child of ['encounter_votes', 'encounter_formations']) {
            const at = indexOfDelete(ops, child);
            expect(at, `${child} must be deleted before encounter_notes`).toBeGreaterThanOrEqual(0);
            expect(at, `${child} must be deleted before encounter_notes`).toBeLessThan(noteDelete);
        }
    });
});
