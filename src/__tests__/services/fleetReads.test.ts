import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import {
    INVENTORY_BATCH_SIZE,
    fetchInventory,
    fetchShips,
    transformGearData,
} from '../../services/fleetReads';
import { encodeGearStats } from '../../utils/gear/statsCodec';
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

const gearRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    user_id: USER,
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    set_bonus: 'ATTACK',
    calibration_ship_id: null,
    stats: encodeGearStats({
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [{ name: 'crit', value: 5, type: 'percentage' }],
    }),
    ...overrides,
});

/** Zero-padded so string order is numeric order, the way keyset paging on uuids is. */
const gearId = (n: number) => `gear-${String(n).padStart(6, '0')}`;

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

describe('fetchInventory', () => {
    it('walks past one page, keyset on the last id', async () => {
        const rows = Array.from({ length: INVENTORY_BATCH_SIZE + 1 }, (_, i) => gearRow(gearId(i)));
        const { db, calls } = stubDb({ inventory_items: rows });

        const items = await fetchInventory(db, USER);

        expect(items).toHaveLength(INVENTORY_BATCH_SIZE + 1);
        expect(calls.filter((call) => call.method === 'gt')).toEqual([
            {
                table: 'inventory_items',
                method: 'gt',
                args: ['id', gearId(INVENTORY_BATCH_SIZE - 1)],
            },
        ]);
    });

    it('reports every page to onBatch with the items read so far', async () => {
        const rows = Array.from({ length: INVENTORY_BATCH_SIZE + 1 }, (_, i) => gearRow(gearId(i)));
        const { db } = stubDb({ inventory_items: rows });
        const seen: number[] = [];

        await fetchInventory(db, USER, { onBatch: (itemsSoFar) => seen.push(itemsSoFar.length) });

        expect(seen).toEqual([INVENTORY_BATCH_SIZE, INVENTORY_BATCH_SIZE + 1]);
    });

    it('resolves to null when cancelled before a page', async () => {
        const { db, calls } = stubDb({ inventory_items: [gearRow(gearId(0))] });

        const items = await fetchInventory(db, USER, { isCancelled: () => true });

        expect(items).toBeNull();
        expect(calls).toEqual([]);
    });

    it('retries a failed page, then succeeds', async () => {
        const { db } = stubDb(
            { inventory_items: [gearRow(gearId(0))] },
            { failTimes: { inventory_items: 2 } }
        );

        const items = await fetchInventory(db, USER, { retryDelayMs: 0 });

        expect(items).toHaveLength(1);
    });

    it('throws once the retries are spent', async () => {
        const { db } = stubDb(
            { inventory_items: [gearRow(gearId(0))] },
            { failTimes: { inventory_items: 4 } }
        );

        await expect(fetchInventory(db, USER, { retryDelayMs: 0 })).rejects.toEqual({
            message: 'inventory_items is unavailable',
        });
    });
});

describe('transformGearData', () => {
    it('decodes the stats column and keeps the calibration', () => {
        const piece = transformGearData(gearRow('g1', { calibration_ship_id: 'ship-1' }));

        expect(piece).toEqual({
            id: 'g1',
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            setBonus: 'ATTACK',
            mainStat: { name: 'attack', value: 100, type: 'flat' },
            subStats: [{ name: 'crit', value: 5, type: 'percentage' }],
            calibration: { shipId: 'ship-1' },
        });
    });
});
