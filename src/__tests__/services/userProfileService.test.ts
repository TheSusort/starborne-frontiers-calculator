import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import { calculateTotalScore } from '../../utils/autogear/scoring';
import { getTopShipRankings } from '../../services/userProfileService';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../utils/autogear/scoring', () => ({ calculateTotalScore: vi.fn(() => 0) }));

const USER = '55555555-5555-4555-8555-555555555555';

/** A query builder whose every filter returns itself and which resolves to `rows` when awaited. */
const selectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        chain[method] = () => chain;
    }
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
};

const shipRow = (type: string) => ({
    id: 'ship-1',
    name: 'Buffer Ship',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type,
    user_id: USER,
    ship_base_stats: {},
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
});

const engineeringRow = (shipType: string, value: number) => ({
    ship_type: shipType,
    stat_name: 'attack',
    value,
    type: 'percentage',
});

describe('getTopShipRankings', () => {
    beforeEach(() => {
        vi.mocked(calculateTotalScore).mockClear();
    });

    it('scores a SUPPORTER_BUFFER ship with the SUPPORTER engineering tree (#577)', async () => {
        vi.mocked(supabase.from).mockImplementation(((table: string) =>
            selectChain(
                table === 'engineering_stats'
                    ? [engineeringRow('SUPPORTER', 7), engineeringRow('ATTACKER', 3)]
                    : [shipRow('SUPPORTER_BUFFER')]
            )) as unknown as typeof supabase.from);

        await getTopShipRankings(USER);

        expect(calculateTotalScore).toHaveBeenCalledTimes(1);
        const getEngineering = vi.mocked(calculateTotalScore).mock.calls[0][4];
        expect(getEngineering('SUPPORTER_BUFFER')?.stats).toEqual([
            { name: 'attack', value: 7, type: 'percentage' },
        ]);
    });
});
