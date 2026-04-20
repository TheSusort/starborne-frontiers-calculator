import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { BaseStats, EngineeringStat } from '../../../../types/stats';
import { GEAR_SLOTS } from '../../../../constants';

/**
 * Tiny deterministic PRNG (mulberry32). Seeded RNG used so tests are reproducible.
 */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const TEST_BASE_STATS: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 8000,
    speed: 300,
    hacking: 500,
    security: 300,
    crit: 30,
    critDamage: 120,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

export const TEST_SET_BONUSES = ['SHIELD', 'DECIMATION', 'BOOST', 'HARDENED'] as const;

export function makeTestShip(overrides: Partial<Ship> = {}): Ship {
    return {
        id: 'ship-1',
        type: 'ATTACKER',
        name: 'TestShip',
        rarity: 'legendary',
        faction: 'FEDERATION',
        baseStats: { ...TEST_BASE_STATS },
        refits: [],
        equipment: {},
        implants: {},
        ...overrides,
    } as Ship;
}

export function makeTestEngineering(): EngineeringStat {
    return {
        shipType: 'ATTACKER',
        stats: [
            { name: 'attack', value: 500, type: 'flat' },
            { name: 'hp', value: 5, type: 'percentage' },
        ],
    };
}

/**
 * Generate a small inventory (default 18 pieces) that covers:
 * - all 6 gear slots
 * - several set bonuses, each with enough pieces to hit 2/4 thresholds
 * - a mix of flat and percentage main stats
 *
 * Deterministic given the same seed.
 */
export function generateTestInventory(seed = 1, count = 18): GearPiece[] {
    const rnd = seededRandom(seed);
    const slots = Object.keys(GEAR_SLOTS);
    const pieces: GearPiece[] = [];

    for (let i = 0; i < count; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const slot = slots[i % slots.length] as keyof typeof GEAR_SLOTS;
        const setBonus = TEST_SET_BONUSES[i % TEST_SET_BONUSES.length];
        const id = `gear-${i}`;
        const mainStatFlat = rnd() < 0.5;
        pieces.push({
            id,
            slot,
            setBonus,
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: mainStatFlat
                ? { name: 'attack', value: 500 + Math.floor(rnd() * 200), type: 'flat' }
                : { name: 'attack', value: 5 + Math.floor(rnd() * 10), type: 'percentage' },
            subStats: [
                { name: 'hp', value: 1000 + Math.floor(rnd() * 500), type: 'flat' },
                { name: 'crit', value: 3 + Math.floor(rnd() * 5), type: 'percentage' },
            ],
        } as GearPiece);
    }
    return pieces;
}
