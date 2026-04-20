import type { Ship } from '../../../../../types/ship';
import type { GearPiece } from '../../../../../types/gear';
import type { BaseStats } from '../../../../../types/stats';
import { GEAR_SLOTS } from '../../../../../constants';

/**
 * Tiny deterministic PRNG (mulberry32). Used to seed simulateUpgrade inside
 * equivalence tests so slow and fast paths see identical random sequences.
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
        faction: 'TERRAN_COMBINE',
        baseStats: { ...TEST_BASE_STATS },
        refits: [],
        equipment: {},
        implants: {},
        ...overrides,
    } as Ship;
}

/**
 * Generate an inventory where every piece has level < 16 (so every piece is
 * eligible for the upgrade analysis path) and covers all 6 gear slots + the
 * four test set bonuses. Deterministic given the same seed.
 */
export function generateEligibleInventory(seed = 1, count = 24): GearPiece[] {
    const rnd = seededRandom(seed);
    const slots = Object.keys(GEAR_SLOTS);
    const pieces: GearPiece[] = [];
    for (let i = 0; i < count; i++) {
        const slot = slots[i % slots.length];
        const setBonus = i % 3 === 0 ? TEST_SET_BONUSES[i % TEST_SET_BONUSES.length] : null;
        const isPercent = rnd() < 0.5;
        pieces.push({
            id: `g${i}`,
            slot,
            setBonus,
            rarity: 'legendary',
            level: Math.floor(rnd() * 12), // 0..11 — always < 16
            stars: 5 + Math.floor(rnd() * 2), // 5 or 6
            mainStat: isPercent
                ? { name: 'attack', value: 5 + Math.floor(rnd() * 10), type: 'percentage' }
                : { name: 'attack', value: 300 + Math.floor(rnd() * 200), type: 'flat' },
            subStats: [
                { name: 'hp', value: 800 + Math.floor(rnd() * 500), type: 'flat' },
                { name: 'crit', value: 3 + Math.floor(rnd() * 5), type: 'percentage' },
            ],
        } as GearPiece);
    }
    return pieces;
}

/**
 * Relative-or-absolute float closeness helper.
 * - { abs: N } → absolute tolerance |a-b| <= N
 * - { relative: true } → relative tolerance matching the plan's score policy
 */
export function assertFloatsClose(
    a: number,
    b: number,
    mode: { abs: number } | { relative: true }
): void {
    if ('abs' in mode) {
        if (Math.abs(a - b) > mode.abs) {
            throw new Error(`expected |${a} - ${b}| <= ${mode.abs} (abs), got ${Math.abs(a - b)}`);
        }
    } else {
        const scale = Math.max(1, Math.abs(a), Math.abs(b));
        if (Math.abs(a - b) > 1e-6 * scale) {
            throw new Error(
                `expected |${a} - ${b}| <= 1e-6 * ${scale} (relative), got ${Math.abs(a - b)}`
            );
        }
    }
}
