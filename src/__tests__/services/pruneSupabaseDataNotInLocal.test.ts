import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pruneSupabaseDataNotInLocal } from '../../services/userDataService';
import { StorageKey, inventoryCacheKey } from '../../constants/storage';
import { getFromIndexedDB } from '../../hooks/useStorage';
import { deletesOn, fakeSupabase, indexOfDelete, PAGE_SIZE } from './fakeSupabase';

const USER = '22222222-2222-4222-8222-222222222222';

/** Every prunable section, as a restore of a complete backup file would pass. */
const ALL_SECTIONS = [
    StorageKey.SHIPS,
    StorageKey.INVENTORY,
    StorageKey.ENCOUNTERS,
    StorageKey.LOADOUTS,
    StorageKey.TEAM_LOADOUTS,
    StorageKey.AUTOGEAR_TEAMS,
];

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({ getFromIndexedDB: vi.fn() }));

describe('pruneSupabaseDataNotInLocal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    it('deletes only the cloud ships that the local snapshot does not have', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([{ id: 'keep-ship' }]));
        const ops = fakeSupabase({ ships: [{ id: 'keep-ship' }, { id: 'stale-ship' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

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

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const gearDeletes = deletesOn(ops, 'inventory_items');
        expect(gearDeletes).toHaveLength(1);
        expect(gearDeletes[0].values).toEqual(['stale-gear']);
    });

    it('deletes only the cloud encounter notes that the local snapshot does not have', async () => {
        localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify([{ id: 'keep-note' }]));
        const ops = fakeSupabase({ encounter_notes: [{ id: 'keep-note' }, { id: 'stale-note' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

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

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        expect(ops.filter((op) => op.kind === 'delete')).toEqual([]);
    });

    it('clears calibration pointing at a stale ship before deleting that ship', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const ops = fakeSupabase({ ships: [{ id: 'stale-ship' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

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

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

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

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const gearDelete = indexOfDelete(ops, 'inventory_items');
        // ship_implants.id IS the gear id, and ship_implant_stats.implant_id FKs
        // to it — pruning an implant that carries stats needs both cleared.
        for (const child of [
            'ship_equipment',
            'ship_implant_stats',
            'ship_implants',
            'loadout_equipment',
            'team_loadout_equipment',
        ]) {
            const at = indexOfDelete(ops, child);
            expect(at, `${child} must be cleared before inventory_items`).toBeGreaterThanOrEqual(0);
            expect(at, `${child} must be cleared before inventory_items`).toBeLessThan(gearDelete);
        }
    });

    it('deletes only the cloud loadouts the local snapshot does not have, children first', async () => {
        localStorage.setItem(StorageKey.LOADOUTS, JSON.stringify([{ id: 'keep-lo' }]));
        const ops = fakeSupabase({ loadouts: [{ id: 'keep-lo' }, { id: 'stale-lo' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const loadoutDeletes = deletesOn(ops, 'loadouts');
        expect(loadoutDeletes).toHaveLength(1);
        expect(loadoutDeletes[0].values).toEqual(['stale-lo']);
        expect(indexOfDelete(ops, 'loadout_equipment')).toBeLessThan(
            indexOfDelete(ops, 'loadouts')
        );
    });

    it('deletes only the cloud team loadouts the local snapshot does not have, children first', async () => {
        localStorage.setItem(StorageKey.TEAM_LOADOUTS, JSON.stringify([{ id: 'keep-tl' }]));
        const ops = fakeSupabase({ team_loadouts: [{ id: 'keep-tl' }, { id: 'stale-tl' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const teamDeletes = deletesOn(ops, 'team_loadouts');
        expect(teamDeletes).toHaveLength(1);
        expect(teamDeletes[0].values).toEqual(['stale-tl']);
        for (const child of ['team_loadout_equipment', 'team_loadout_ships']) {
            expect(indexOfDelete(ops, child), `${child} before team_loadouts`).toBeLessThan(
                indexOfDelete(ops, 'team_loadouts')
            );
        }
    });

    it('deletes only the cloud autogear teams the local snapshot does not have', async () => {
        localStorage.setItem(StorageKey.AUTOGEAR_TEAMS, JSON.stringify([{ id: 'keep-at' }]));
        const ops = fakeSupabase({ autogear_teams: [{ id: 'keep-at' }, { id: 'stale-at' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const teamDeletes = deletesOn(ops, 'autogear_teams');
        expect(teamDeletes).toHaveLength(1);
        expect(teamDeletes[0].values).toEqual(['stale-at']);
    });

    // loadouts.ship_id, team_loadout_ships.ship_id and team_loadout_equipment.ship_id
    // all FK to ships, so a row the local snapshot keeps can still point at a ship
    // the snapshot drops. Those references must go before the ship row does.
    it('clears loadout rows pointing at a stale ship before deleting that ship', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const ops = fakeSupabase({
            ships: [{ id: 'stale-ship' }],
            loadouts: [{ id: 'lo-on-stale' }],
        });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const shipDelete = indexOfDelete(ops, 'ships');
        for (const child of ['team_loadout_equipment', 'team_loadout_ships', 'loadouts']) {
            const at = ops.findIndex(
                (op, i) => i < shipDelete && op.table === child && op.kind === 'delete'
            );
            expect(
                at,
                `${child} referencing a stale ship must be cleared first`
            ).toBeGreaterThanOrEqual(0);
        }
    });

    // The prune compares the cloud against CURRENT LOCAL STATE, which a restore
    // only rewrote for the keys the file carried. Pruning a section the file
    // never mentioned would delete cloud rows against whatever happened to be
    // cached locally — and every backup taken before gear was included lacks
    // the inventory key entirely.
    it('leaves a section the backup file did not carry completely alone', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const ops = fakeSupabase({
            ships: [{ id: 'cloud-ship' }],
            inventory_items: [{ id: 'cloud-gear' }],
        });

        await pruneSupabaseDataNotInLocal(USER, [StorageKey.SHIPS]);

        expect(deletesOn(ops, 'ships')).toHaveLength(1);
        expect(deletesOn(ops, 'inventory_items')).toEqual([]);
    });

    it('prunes nothing at all when the backup file carried no prunable section', async () => {
        const ops = fakeSupabase({
            ships: [{ id: 'cloud-ship' }],
            inventory_items: [{ id: 'cloud-gear' }],
        });

        await pruneSupabaseDataNotInLocal(USER, [StorageKey.CHANGELOG_STATE]);

        expect(ops.filter((op) => op.kind === 'delete')).toEqual([]);
    });

    // PostgREST caps a single select at the project's `db-max-rows`. A truncated
    // id read makes the prune act on a partial picture: stale rows survive, and
    // a truncated CHILD read deletes only some of a parent's children and then
    // fails the parent delete on the FK. A real account holds tens of thousands
    // of gear rows, so this is the normal case, not an edge case.
    it('reads every page of ids rather than the first response', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `ship-${i}` }));
        const ops = fakeSupabase({ ships: [...firstPage, { id: 'ship-on-page-two' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const deleted = deletesOn(ops, 'ships').flatMap((op) => op.values ?? []);
        expect(deleted).toContain('ship-on-page-two');
        expect(deleted).toHaveLength(PAGE_SIZE + 1);
    });

    it('orders paged id reads, so the pages cannot overlap or skip', async () => {
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
        const ops = fakeSupabase({ ships: [{ id: 'a' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const selects = ops.filter((op) => op.table === 'ships' && op.kind === 'select');
        expect(selects.length).toBeGreaterThan(0);
        for (const select of selects) {
            expect(select.ordered, 'every paged id read must be ordered').toBe(true);
        }
    });

    it('deletes encounter children before the note row', async () => {
        localStorage.setItem(StorageKey.ENCOUNTERS, JSON.stringify([]));
        const ops = fakeSupabase({ encounter_notes: [{ id: 'stale-note' }] });

        await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

        const noteDelete = indexOfDelete(ops, 'encounter_notes');
        for (const child of ['encounter_votes', 'encounter_formations']) {
            const at = indexOfDelete(ops, child);
            expect(at, `${child} must be deleted before encounter_notes`).toBeGreaterThanOrEqual(0);
            expect(at, `${child} must be deleted before encounter_notes`).toBeLessThan(noteDelete);
        }
    });
});
