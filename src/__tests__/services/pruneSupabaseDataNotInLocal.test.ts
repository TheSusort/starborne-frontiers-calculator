import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pruneSupabaseDataNotInLocal, PRUNABLE_SECTIONS } from '../../services/userDataService';
import { StorageKey, inventoryCacheKey } from '../../constants/storage';
import { getFromIndexedDB } from '../../hooks/useStorage';
import { deletedValues, deletesOn, fakeSupabase, indexOfDelete, PAGE_SIZE } from './fakeSupabase';

const USER = '22222222-2222-4222-8222-222222222222';

/** A cloud `updated_at`, in the shape PostgREST returns. */
const STAMP = '2026-09-13T10:00:00+00:00';

/** Every prunable section, as a restore of a complete backup file would pass. */
const ALL_SECTIONS = [
    StorageKey.SHIPS,
    StorageKey.INVENTORY,
    StorageKey.ENCOUNTERS,
    StorageKey.LOADOUTS,
    StorageKey.TEAM_LOADOUTS,
    StorageKey.AUTOGEAR_TEAMS,
    StorageKey.AUTOGEAR_CONFIGS,
    StorageKey.ENGINEERING_STATS,
];

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({ getFromIndexedDB: vi.fn() }));

describe('pruneSupabaseDataNotInLocal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    // A section added to the service and not to this fixture would be exercised by
    // no test here, and every case below would pass while never reaching it.
    it('names every section the service knows how to prune', () => {
        expect([...ALL_SECTIONS].sort()).toEqual([...PRUNABLE_SECTIONS].sort());
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
    // Naming a section is only half the permission: the local state it will be
    // compared against has to be readable. A key that is missing or unparseable
    // yields the same empty default as a user who owns nothing, and acting on
    // that deletes the cloud copy — the exact loss this function exists to stop.
    describe('a section whose local read did not land', () => {
        it('leaves the cloud alone when the local key holds unparseable JSON', async () => {
            localStorage.setItem(StorageKey.SHIPS, '{ not json');
            const ops = fakeSupabase({ ships: [{ id: 'cloud-ship' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
        });

        it('leaves the cloud alone when the local key holds the wrong shape', async () => {
            localStorage.setItem(StorageKey.SHIPS, JSON.stringify({ ships: [] }));
            const ops = fakeSupabase({ ships: [{ id: 'cloud-ship' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
        });

        it('leaves the cloud alone when the local key is absent entirely', async () => {
            const ops = fakeSupabase({ ships: [{ id: 'cloud-ship' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
        });

        // The gear cache is IndexedDB, where "no record for this key" resolves
        // undefined. On a device that has never loaded the inventory that is
        // the normal state, and it is not the same fact as a record holding [].
        it('leaves cloud gear alone when the gear cache has no record', async () => {
            (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
            const ops = fakeSupabase({ inventory_items: [{ id: 'cloud-gear' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'inventory_items')).toEqual([]);
        });

        // The contrast that keeps the test above from passing for the wrong
        // reason: a record that IS there and empty still prunes, which is how
        // clear-and-resync empties a cloud the user has emptied locally.
        it('still prunes when the gear cache holds an empty record', async () => {
            (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([]);
            const ops = fakeSupabase({ inventory_items: [{ id: 'cloud-gear' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletedValues(ops, 'inventory_items')).toEqual(['cloud-gear']);
        });

        // The shape check has to reach the ROWS, not just the container. A section of
        // id-less objects reads as present, contributes `undefined` to the id set, and then
        // every cloud row counts as stale — the whole cloud copy deleted from a local value
        // that describes nothing.
        it('leaves the cloud alone when the rows carry no usable id', async () => {
            localStorage.setItem(StorageKey.SHIPS, JSON.stringify([{}, {}]));
            const ops = fakeSupabase({ ships: [{ id: 'cloud-ship' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
        });

        it('leaves the cloud alone when only one row is missing its id', async () => {
            localStorage.setItem(
                StorageKey.SHIPS,
                JSON.stringify([{ id: 'keep-ship' }, { name: 'no id here' }])
            );
            const ops = fakeSupabase({ ships: [{ id: 'keep-ship' }, { id: 'other' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
        });

        it('leaves cloud gear alone when the cached rows carry no usable id', async () => {
            (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue([{ slot: 'weapon' }]);
            const ops = fakeSupabase({ inventory_items: [{ id: 'cloud-gear' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'inventory_items')).toEqual([]);
        });

        it('still prunes when the local key is there and holds an empty list', async () => {
            localStorage.setItem(StorageKey.SHIPS, JSON.stringify([]));
            const ops = fakeSupabase({ ships: [{ id: 'cloud-ship' }] });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletedValues(ops, 'ships')).toEqual(['cloud-ship']);
        });
    });
    // autogear_configs is keyed `(user_id, ship_id)` and the local section is an
    // OBJECT keyed by ship id, not a list of rows carrying their own `id`. The
    // comparison is therefore ship id against ship id, while the delete still
    // goes by the row's `id` primary key.
    describe('autogear configs', () => {
        it('deletes only the cloud configs whose ship the local section does not name', async () => {
            localStorage.setItem(
                StorageKey.AUTOGEAR_CONFIGS,
                JSON.stringify({ 'keep-ship': { name: 'kept' } })
            );
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-keep', ship_id: 'keep-ship', updated_at: STAMP },
                    { id: 'cfg-stale', ship_id: 'gone-ship', updated_at: STAMP },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const deletes = deletesOn(ops, 'autogear_configs');
            expect(deletes).toHaveLength(1);
            expect(deletes[0].column).toBe('id');
            expect(deletes[0].values).toEqual(['cfg-stale']);
        });

        // The shape the partial fix in #521 would have missed: the ship is still
        // owned locally, only its config was removed. Pruning configs off the
        // ships' stale set alone reports success and deletes nothing.
        it('deletes a config whose ship the local snapshot still keeps', async () => {
            localStorage.setItem(
                StorageKey.SHIPS,
                JSON.stringify([{ id: 'kept-ship', updated_at: STAMP }])
            );
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                ships: [{ id: 'kept-ship', updated_at: STAMP }],
                autogear_configs: [{ id: 'cfg-1', ship_id: 'kept-ship', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'ships')).toEqual([]);
            expect(deletedValues(ops, 'autogear_configs')).toEqual(['cfg-1']);
        });

        it('leaves cloud configs alone when the local key is absent entirely', async () => {
            const ops = fakeSupabase({
                autogear_configs: [{ id: 'cfg-1', ship_id: 'a', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        it('leaves cloud configs alone when the local key holds unparseable JSON', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, '{not json');
            const ops = fakeSupabase({
                autogear_configs: [{ id: 'cfg-1', ship_id: 'a', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        // `null` and every scalar parse cleanly and are not the object this section
        // is; a section read as present is one the cloud copy is replaced from.
        it('leaves cloud configs alone when the local key parses to null', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, 'null');
            const ops = fakeSupabase({
                autogear_configs: [{ id: 'cfg-1', ship_id: 'a', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        it('leaves cloud configs alone when the caller did not name the section', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [{ id: 'cfg-1', ship_id: 'a', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, [StorageKey.SHIPS]);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        it('prunes every config when the local key is there and holds no entries', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-1', ship_id: 'a', updated_at: STAMP },
                    { id: 'cfg-2', ship_id: 'b', updated_at: STAMP },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletedValues(ops, 'autogear_configs')).toEqual(['cfg-1', 'cfg-2']);
        });

        // The read is of `(id, ship_id)`, not of `id`, so it does not ride on the
        // path the other sections' paging is proven over.
        it('reads every page of configs rather than the first response', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({
                id: `cfg-${i}`,
                ship_id: `ship-${i}`,
                updated_at: STAMP,
            }));
            const ops = fakeSupabase({
                autogear_configs: [
                    ...firstPage,
                    { id: 'cfg-on-page-two', ship_id: 'late-ship', updated_at: STAMP },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const deleted = deletedValues(ops, 'autogear_configs');
            expect(deleted).toContain('cfg-on-page-two');
            expect(deleted).toHaveLength(PAGE_SIZE + 1);
        });

        // The mirror of `hasUsableId` on the CLOUD side. A row with no `ship_id`
        // is not in any local key set, so it and every row beside it read as
        // stale and the whole table goes. A partial answer is a wrong answer.
        it('leaves every config alone when a cloud row carries no ship id', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({ 'keep-ship': {} }));
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-keep', ship_id: 'keep-ship', updated_at: STAMP },
                    { id: 'cfg-broken', updated_at: STAMP },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        // A config saved between the stale read and the delete must survive it.
        // There is no server `now()` to read without an RPC and a client clock
        // skews, so the watermark is the newest `updated_at` the read itself saw:
        // any write whose transaction starts after that read carries a later one.
        // Inert without the `update_autogear_configs_updated_at` trigger, which
        // is what makes an upsert's UPDATE branch move the column at all.
        it('bounds the delete by the newest updated_at the read saw', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-1', ship_id: 'a', updated_at: '2026-09-13T10:00:00+00:00' },
                    { id: 'cfg-2', ship_id: 'b', updated_at: '2026-09-13T12:00:00+00:00' },
                    { id: 'cfg-3', ship_id: 'c', updated_at: '2026-09-13T11:00:00+00:00' },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const deletes = deletesOn(ops, 'autogear_configs');
            expect(deletes.length).toBeGreaterThan(0);
            for (const op of deletes) {
                expect(op.upperBounds?.updated_at).toBe('2026-09-13T12:00:00+00:00');
            }
        });

        it('compares watermarks as raw strings, not through Date', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            // Same millisecond, different microseconds: `Date.parse` truncates
            // both to the same value and would pick whichever came first.
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-1', ship_id: 'a', updated_at: '2026-09-13T12:00:00.123999+00:00' },
                    { id: 'cfg-2', ship_id: 'b', updated_at: '2026-09-13T12:00:00.123001+00:00' },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')[0].upperBounds?.updated_at).toBe(
                '2026-09-13T12:00:00.123999+00:00'
            );
        });

        it('leaves every config alone when a cloud row carries no updated_at', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [
                    { id: 'cfg-1', ship_id: 'a', updated_at: STAMP },
                    { id: 'cfg-2', ship_id: 'b' },
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        it('leaves every config alone when a cloud row carries no id', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [{ ship_id: 'a', updated_at: '2026-09-13T10:00:00+00:00' }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'autogear_configs')).toEqual([]);
        });

        it('orders the paged config read, so the pages cannot overlap or skip', async () => {
            localStorage.setItem(StorageKey.AUTOGEAR_CONFIGS, JSON.stringify({}));
            const ops = fakeSupabase({
                autogear_configs: [{ id: 'cfg-1', ship_id: 'a', updated_at: STAMP }],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const selects = ops.filter(
                (op) => op.table === 'autogear_configs' && op.kind === 'select'
            );
            expect(selects.length).toBeGreaterThan(0);
            for (const select of selects) {
                expect(select.ordered, 'every paged read must be ordered').toBe(true);
            }
        });
    });

    /**
     * engineering_stats is keyed `(user_id, ship_type, stat_name)` and has no `id`, so both
     * the read's order and the delete's predicates are composite. The local section is one
     * object whose rows live under `stats`, keyed by the same pair.
     */
    describe('engineering stats', () => {
        const engineering = (stats: unknown[]) => JSON.stringify({ stats });

        /**
         * Microsecond precision, the way PostgREST returns it: the watermark is compared as a
         * raw string, and `Date.parse` would truncate these to the same millisecond.
         */
        const STAMPS = ['2026-09-14T10:00:00.000001+00:00', '2026-09-14T10:00:00.000002+00:00'];

        const cloudStat = (shipType: string, statName: string, updatedAt = STAMPS[0]) => ({
            ship_type: shipType,
            stat_name: statName,
            updated_at: updatedAt,
        });

        const attacker = (names: string[]) => [
            {
                shipType: 'ATTACKER',
                stats: names.map((name) => ({ name, value: 1, type: 'flat' })),
            },
        ];

        it('deletes the cloud stats the local section does not name, and keeps the ones it does', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering(attacker(['attack'])));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack'), cloudStat('ATTACKER', 'hp')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletedValues(ops, 'engineering_stats')).toEqual(['hp']);
        });

        // Without the ship_type predicate the delete takes that stat name out of EVERY ship
        // type, so the surviving row here is the whole point of asserting on all three.
        it('scopes the delete to the user, the ship type and the stat names', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering(attacker(['attack'])));
            const ops = fakeSupabase({
                engineering_stats: [
                    cloudStat('ATTACKER', 'attack'),
                    cloudStat('DEFENDER', 'attack'),
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const deletes = deletesOn(ops, 'engineering_stats');
            expect(deletes).toHaveLength(1);
            expect(deletes[0].filters).toEqual([
                { column: 'user_id', values: [USER] },
                { column: 'ship_type', values: ['DEFENDER'] },
                { column: 'stat_name', values: ['attack'] },
            ]);
        });

        // Both writers of this table upsert on `(user_id, ship_type, stat_name)`, so one can
        // UPDATE a row the local section does not name — a row this read already counted as
        // stale. The bound is the newest row READ, not a clock: there is no server `now()` to
        // select without an RPC, and a row bumped after the read carries a later stamp.
        it('bounds the delete by the newest updated_at the read saw', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering(attacker(['attack'])));
            const ops = fakeSupabase({
                engineering_stats: [
                    cloudStat('ATTACKER', 'attack', STAMPS[1]),
                    cloudStat('ATTACKER', 'hp', STAMPS[0]),
                ],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const deletes = deletesOn(ops, 'engineering_stats');
            expect(deletes).toHaveLength(1);
            expect(deletes[0].upperBounds).toEqual({ updated_at: STAMPS[1] });
        });

        // The read asks for the column the bound is computed from. Reading only the identity
        // columns leaves the watermark null and the prune silently stops deleting.
        it('reads the column the bound is computed from', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const select = ops.find(
                (op) => op.table === 'engineering_stats' && op.kind === 'select'
            );
            expect(select?.columns).toEqual(['ship_type', 'stat_name', 'updated_at']);
        });

        // PostgREST errors on `order=id` for a table with no such column, so the read would
        // fail outright in production while an unordered fake served it happily.
        it('orders the paged read by the columns the table actually has', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            const selects = ops.filter(
                (op) => op.table === 'engineering_stats' && op.kind === 'select'
            );
            expect(selects.length).toBeGreaterThan(0);
            for (const select of selects) {
                expect(select.orderedBy).toEqual(['ship_type', 'stat_name']);
            }
        });

        it('prunes every stat when the local section is there and holds no entries', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack'), cloudStat('DEFENDER', 'hp')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletedValues(ops, 'engineering_stats')).toEqual(['attack', 'hp']);
        });

        // The cloud-side mirror of the local shape check: a row with no identity is in no
        // local key set, so it and every row read beside it would count as stale.
        it.each([['stat_name'], ['ship_type'], ['updated_at']])(
            'leaves every stat alone when a cloud row carries no %s',
            async (column) => {
                localStorage.setItem(
                    StorageKey.ENGINEERING_STATS,
                    engineering(attacker(['attack']))
                );
                const broken: Record<string, string> = cloudStat('DEFENDER', 'hp');
                delete broken[column];
                const ops = fakeSupabase({
                    engineering_stats: [cloudStat('ATTACKER', 'attack'), broken],
                });

                await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

                expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
            }
        );

        // A local entry with no ship type or a stat with no name contributes no pair, so its
        // cloud rows would read as stale from a local value that describes nothing.
        it.each([
            ['an entry carries no ship type', [{ stats: [{ name: 'attack', value: 1 }] }]],
            ['a stat carries no name', [{ shipType: 'ATTACKER', stats: [{ value: 1 }] }]],
            ['an entry carries no stats array', [{ shipType: 'ATTACKER' }]],
        ])('leaves every stat alone when %s', async (_label, stats) => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering(stats));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        // The section is an OBJECT, so `readLocalSection` accepts any object: `{}` and an
        // object whose `stats` is not an array read as present and name no pair at all.
        it.each([
            ['absent entirely', null],
            ['unparseable JSON', '{ not json'],
            ['null', 'null'],
            ['an object with no stats', '{}'],
            ['an object whose stats is not a list', '{"stats":5}'],
        ])('leaves every stat alone when the local section is %s', async (_label, raw) => {
            if (raw !== null) localStorage.setItem(StorageKey.ENGINEERING_STATS, raw);
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack')],
            });

            await pruneSupabaseDataNotInLocal(USER, ALL_SECTIONS);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });

        it('leaves every stat alone when the caller did not name the section', async () => {
            localStorage.setItem(StorageKey.ENGINEERING_STATS, engineering([]));
            const ops = fakeSupabase({
                engineering_stats: [cloudStat('ATTACKER', 'attack')],
            });

            await pruneSupabaseDataNotInLocal(USER, [StorageKey.SHIPS]);

            expect(deletesOn(ops, 'engineering_stats')).toEqual([]);
        });
    });
});
