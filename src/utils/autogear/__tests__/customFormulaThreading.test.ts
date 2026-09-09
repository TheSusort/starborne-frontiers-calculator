import { describe, it, expect, beforeEach } from 'vitest';
import { calculateTotalScore, clearScoreCache } from '../scoring';
import type { CustomFormula } from '../../../types/autogear';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { AutogearAlgorithm } from '../AutogearStrategy';
import { getAutogearStrategy } from '../getStrategy';

const attackFormula: CustomFormula = {
    rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
};
const speedFormula: CustomFormula = {
    rows: [{ stat: 'speed', kind: 'core', direction: 'max' }],
};

const ship: Ship = {
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    baseStats: {
        hp: 20000,
        attack: 8000,
        defence: 4000,
        speed: 120,
        hacking: 0,
        security: 0,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    level: 60,
    rank: 6,
    equipment: {},
    refits: [],
    implants: {},
};

const getGearPiece = (): GearPiece | undefined => undefined;
const getEngineeringStats = () => undefined;

const score = (formula: CustomFormula | undefined) =>
    calculateTotalScore(
        ship,
        {},
        [],
        getGearPiece,
        getEngineeringStats,
        undefined,
        [],
        [],
        false,
        null,
        [],
        formula
    );

describe('calculateTotalScore threads the custom formula', () => {
    beforeEach(() => clearScoreCache());

    it('scores a roleless build from the formula it is given', () => {
        expect(score(attackFormula)).toBeGreaterThan(0);
    });

    it('scores 0 for a roleless build with no formula', () => {
        expect(score(undefined)).toBe(0);
    });

    it('gives two different formulas two different scores without an intervening clear', () => {
        // The memo cache key includes the formula, so two formulas scored on the
        // same ship and gear never share a cache entry.
        const a = score(attackFormula);
        const b = score(speedFormula);
        expect(a).not.toBeCloseTo(b, 6);
    });
});

// A gear piece that is strong in attack and weak in speed, and its mirror. A strategy
// that forwards the formula picks a different one for each formula; a strategy that drops
// it scores every candidate 0 and returns whatever its tie-break happens to yield.
const attackPiece: GearPiece = {
    id: 'gear-attack',
    slot: 'weapon',
    level: 12,
    stars: 5,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 4000, type: 'flat' },
    subStats: [],
    setBonus: 'CRITICAL',
};

const speedPiece: GearPiece = {
    id: 'gear-speed',
    slot: 'weapon',
    level: 12,
    stars: 5,
    rarity: 'legendary',
    mainStat: { name: 'speed', value: 40, type: 'flat' },
    subStats: [],
    setBonus: 'HASTE',
};

const inventory = [attackPiece, speedPiece];
const resolve = (id: string) => inventory.find((p) => p.id === id);

describe('every registered strategy forwards the custom formula', () => {
    // Keyed to the AutogearAlgorithm enum, not to a list of strategy files, so a strategy
    // added later is covered without anyone remembering to extend this test.
    for (const algorithm of Object.values(AutogearAlgorithm)) {
        it(`${algorithm} picks a different piece for an attack formula than a speed formula`, async () => {
            clearScoreCache();
            const strategy = getAutogearStrategy(algorithm);

            const forAttack = await Promise.resolve(
                strategy.findOptimalGear(
                    ship,
                    [],
                    inventory,
                    resolve,
                    getEngineeringStats,
                    undefined,
                    [],
                    [],
                    false,
                    null,
                    [],
                    attackFormula
                )
            );
            clearScoreCache();
            const forSpeed = await Promise.resolve(
                strategy.findOptimalGear(
                    ship,
                    [],
                    inventory,
                    resolve,
                    getEngineeringStats,
                    undefined,
                    [],
                    [],
                    false,
                    null,
                    [],
                    speedFormula
                )
            );

            const pick = (r: { suggestions: { gearId: string }[] }) =>
                r.suggestions.find((s) => s.gearId)?.gearId;
            expect(pick(forAttack)).toBe('gear-attack');
            expect(pick(forSpeed)).toBe('gear-speed');
        });
    }
});
