/**
 * The stat page's Hardened bonus: the `damageReduction` stat ("Critical DR" — less damage taken
 * from critical hits), 5% per COMPLETE set, the same per-set count the combat sim uses
 * (`completeSetCount`). It does not stack with Iridium's innate 35% crit damage reduction: the
 * higher of the two applies.
 */
import { describe, it, expect } from 'vitest';
import { calculateTotalStats } from '../statsCalculator';
import { STATS } from '../../../constants/stats';
import type { GearPiece } from '../../../types/gear';
import type { BaseStats } from '../../../types/stats';

const SLOTS = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;

const base = (over: Partial<BaseStats> = {}): BaseStats => ({
    hp: 10_000,
    attack: 1000,
    defence: 1000,
    hacking: 0,
    security: 0,
    crit: 0,
    critDamage: 0,
    speed: 100,
    ...over,
});

const finalCritDr = (pieces: number, baseStats: BaseStats) => {
    const equipment: Record<string, string> = {};
    const lookup: Record<string, GearPiece> = {};
    for (let i = 0; i < pieces; i++) {
        const id = `h-${i}`;
        equipment[SLOTS[i]] = id;
        lookup[id] = {
            id,
            slot: SLOTS[i],
            level: 0,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'HARDENED',
        };
    }
    return (
        calculateTotalStats(baseStats, equipment, (id) => lookup[id], [], {}, undefined).final
            .damageReduction ?? 0
    );
};

describe('Hardened on the stat page', () => {
    it('is labelled as crit damage reduction', () => {
        expect(STATS.damageReduction.label).toBe('Critical DR');
    });

    it('adds 5% crit damage reduction per complete set (5 pieces = 2 sets)', () => {
        for (const [pieces, expected] of [
            [1, 0],
            [2, 5],
            [4, 10],
            [5, 10],
            [6, 15],
        ] as const) {
            expect(finalCritDr(pieces, base())).toBe(expected);
        }
    });

    it("does not stack with Iridium's innate 35%: the higher applies", () => {
        expect(finalCritDr(6, base({ damageReduction: 35 }))).toBe(35);
        expect(finalCritDr(0, base({ damageReduction: 35 }))).toBe(35);
    });
});
