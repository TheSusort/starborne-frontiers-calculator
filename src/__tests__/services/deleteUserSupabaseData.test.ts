import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteUserSupabaseData } from '../../services/userDataService';
import {
    BATCH_SIZE,
    deletedValues,
    deletesOn,
    fakeSupabase,
    ForeignKey,
    indexOfDelete,
    Op,
    PAGE_SIZE,
} from './fakeSupabase';

const USER = '33333333-3333-4333-8333-333333333333';

/** One page plus a remainder, the shape a real account's inventory has. */
const OVERSIZED = PAGE_SIZE + 200;

const rows = (prefix: string, extra: (i: number) => Record<string, unknown> = () => ({})) =>
    Array.from({ length: OVERSIZED }, (_, i) => ({ id: `${prefix}-${i}`, ...extra(i) }));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({ getFromIndexedDB: vi.fn() }));

describe('deleteUserSupabaseData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Account deletion that removes a page of a table and calls it done is a
    // data-retention failure, not a cosmetic one.
    it('deletes every inventory row, not just the first page of ids', async () => {
        const ops = fakeSupabase({ inventory_items: rows('gear') });

        await deleteUserSupabaseData(USER);

        const deleted = deletedValues(ops, 'inventory_items');
        expect(deleted).toHaveLength(OVERSIZED);
        expect(deleted).toContain(`gear-${OVERSIZED - 1}`);
    });

    // Each of these parents is read for its ids and then used to clear a child
    // table that carries no user_id of its own.
    const PARENTS: Array<{ parent: string; child: string; column: string }> = [
        { parent: 'team_loadouts', child: 'team_loadout_equipment', column: 'team_loadout_id' },
        { parent: 'team_loadouts', child: 'team_loadout_ships', column: 'team_loadout_id' },
        { parent: 'loadouts', child: 'loadout_equipment', column: 'loadout_id' },
        { parent: 'encounter_notes', child: 'encounter_votes', column: 'encounter_id' },
        { parent: 'encounter_notes', child: 'encounter_formations', column: 'note_id' },
        { parent: 'ships', child: 'ship_equipment', column: 'ship_id' },
        { parent: 'ships', child: 'ship_base_stats', column: 'ship_id' },
    ];

    it.each(PARENTS)(
        'clears $child for every $parent id, past the first page',
        async ({ parent, child, column }) => {
            const ops = fakeSupabase({ [parent]: rows(parent) });

            await deleteUserSupabaseData(USER);

            const cleared = deletesOn(ops, child).filter((op) => op.column === column);
            const values = cleared.flatMap((op) => op.values ?? []);
            expect(values).toHaveLength(OVERSIZED);
            expect(values).toContain(`${parent}-${OVERSIZED - 1}`);
        }
    );

    // A single `.in()` list of every id is the other half of the same problem:
    // one statement carrying tens of thousands of ids times out.
    it('batches every delete rather than sending one oversized id list', async () => {
        const ops = fakeSupabase({ ships: rows('ships'), inventory_items: rows('gear') });

        await deleteUserSupabaseData(USER);

        const oversized = ops
            .filter((op) => op.kind === 'delete' && (op.values?.length ?? 0) > BATCH_SIZE)
            .map((op) => `${op.table}.${op.column} (${op.values?.length})`);
        expect(oversized).toEqual([]);
    });

    describe('ship child tables', () => {
        // Deleting the implants of a user with more than a page of them fails on
        // the FK unless every implant's stats row was cleared first — the run
        // then aborts partway, leaving the account half deleted.
        const SHIP_IDS = ['ship-a', 'ship-b', 'ship-c'];
        const FOREIGN_KEYS: ForeignKey[] = [
            { child: 'ship_implant_stats', column: 'implant_id', parent: 'ship_implants' },
            { child: 'ship_refit_stats', column: 'refit_id', parent: 'ship_refits' },
            { child: 'ship_implants', column: 'ship_id', parent: 'ships' },
            { child: 'ship_refits', column: 'ship_id', parent: 'ships' },
            { child: 'ship_equipment', column: 'ship_id', parent: 'ships' },
            { child: 'ship_base_stats', column: 'ship_id', parent: 'ships' },
        ];

        const shipCloud = () => {
            const implants = rows('imp', (i) => ({ ship_id: SHIP_IDS[i % SHIP_IDS.length] }));
            const refits = rows('ref', (i) => ({ ship_id: SHIP_IDS[i % SHIP_IDS.length] }));
            return {
                ships: SHIP_IDS.map((id) => ({ id, user_id: USER })),
                ship_equipment: SHIP_IDS.map((id, i) => ({ id: `eq-${i}`, ship_id: id })),
                ship_base_stats: SHIP_IDS.map((id, i) => ({ id: `bs-${i}`, ship_id: id })),
                ship_implants: implants,
                ship_implant_stats: implants.map((implant, i) => ({
                    id: `imp-stat-${i}`,
                    implant_id: implant.id,
                })),
                ship_refits: refits,
                ship_refit_stats: refits.map((refit, i) => ({
                    id: `ref-stat-${i}`,
                    refit_id: refit.id,
                })),
            };
        };

        const run = async (): Promise<Op[]> => {
            const ops = fakeSupabase(shipCloud(), { foreignKeys: FOREIGN_KEYS });
            await deleteUserSupabaseData(USER);
            return ops;
        };

        it('clears the stats of every implant, so the implant delete keeps its FK', async () => {
            const ops = await run();

            const cleared = deletedValues(ops, 'ship_implant_stats');
            expect(cleared).toHaveLength(OVERSIZED);
            expect(cleared).toContain(`imp-${OVERSIZED - 1}`);
        });

        it('clears the stats of every refit, so the refit delete keeps its FK', async () => {
            const ops = await run();

            const cleared = deletedValues(ops, 'ship_refit_stats');
            expect(cleared).toHaveLength(OVERSIZED);
            expect(cleared).toContain(`ref-${OVERSIZED - 1}`);
        });

        it('reaches the ships row itself instead of aborting on a child FK', async () => {
            const ops = await run();

            expect(indexOfDelete(ops, 'ships')).toBeGreaterThanOrEqual(0);
        });
    });
});
