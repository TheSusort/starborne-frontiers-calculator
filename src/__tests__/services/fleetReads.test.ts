import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import { fetchShips } from '../../services/fleetReads';
import { fakeSupabase } from './fakeSupabase';
import { stubDb } from './stubDb';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));

const USER = '55555555-5555-4555-8555-555555555555';

/** The same joined `ships` row shape `rawShipUnionGuards.test.tsx` mounts `ShipsProvider` over. */
const rawShipRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    affinity: null,
    user_id: USER,
    ship_base_stats: {},
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
    ship_templates: { image_key: '', active_skill_text: 'x', active_target: 'enemy' },
    ...overrides,
});

describe('fetchShips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds the Ship the provider stores, from the joined row', async () => {
        fakeSupabase({
            ships: [
                rawShipRow({
                    affinity: 'chemical',
                    level: 60,
                    rank: 6,
                    ship_base_stats: { hp: 1000, attack: 200, crit: 10, crit_damage: 50 },
                    ship_equipment: [{ slot: 'weapon', gear_id: 'g1' }],
                    ship_implants: [{ id: 'imp-row', slot: 'implant_major', description: 'g9' }],
                    ship_refits: [
                        {
                            id: 'r1',
                            ship_refit_stats: [
                                { id: 's1', name: 'attack', value: 5, type: 'percentage' },
                            ],
                        },
                    ],
                }),
            ],
        });

        const ships = await fetchShips(supabase, USER);

        expect(ships).toEqual([
            {
                id: 'ship-1',
                name: 'Test Ship',
                rarity: 'legendary',
                faction: 'ATLAS_SYNDICATE',
                type: 'SUPPORTER',
                affinity: 'chemical',
                copies: 1,
                rank: 6,
                level: 60,
                baseStats: {
                    hp: 1000,
                    attack: 200,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    crit: 10,
                    critDamage: 50,
                    speed: 0,
                    healModifier: 0,
                    hpRegen: 0,
                    shield: 0,
                    defensePenetration: 0,
                    damageReduction: 0,
                },
                equipment: { weapon: 'g1' },
                equipmentLocked: false,
                starred: false,
                refits: [
                    {
                        id: 'r1',
                        stats: [{ id: 's1', name: 'attack', value: 5, type: 'percentage' }],
                    },
                ],
                implants: { implant_major: 'g9' },
                imageKey: '',
                activeSkillText: 'x',
                chargeSkillText: undefined,
                chargeSkillCharge: undefined,
                firstPassiveSkillText: undefined,
                secondPassiveSkillText: undefined,
                thirdPassiveSkillText: undefined,
                activeTarget: 'enemy',
                activePattern: undefined,
                chargedTarget: undefined,
                chargedPattern: undefined,
            },
        ]);
    });

    it('keeps a null affinity as undefined and falls an unknown type back to ATTACKER', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fakeSupabase({ ships: [rawShipRow({ type: 'RETIRED_ROLE' })] });

        const [ship] = await fetchShips(supabase, USER);

        expect(ship.affinity).toBeUndefined();
        expect(ship.type).toBe('ATTACKER');
        warn.mockRestore();
    });

    it('reads only the given profile', async () => {
        const { db, calls } = stubDb({ ships: [rawShipRow()] });

        await fetchShips(db, USER);

        expect(calls).toContainEqual({ table: 'ships', method: 'eq', args: ['user_id', USER] });
    });

    it('throws the Supabase error', async () => {
        const { db } = stubDb({}, { errors: { ships: { message: 'boom' } } });

        await expect(fetchShips(db, USER)).rejects.toEqual({ message: 'boom' });
    });
});
