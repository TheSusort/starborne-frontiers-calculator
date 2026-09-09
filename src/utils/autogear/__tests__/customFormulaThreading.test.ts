import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// xorshift32, seeded — a small deterministic stand-in for Math.random() so the
// genetic case below runs the same GA sequence on every invocation.
function createSeededRandom(seed: number): () => number {
    let state = seed || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state |= 0;
        return (state >>> 0) / 4294967296;
    };
}

// Under this seed the GA's all-ties tie-break lands on the wrong piece for a
// build with no usable formula (asserted below) — the same outcome a strategy
// that drops customFormula produces. A different seed is not guaranteed to.
const GENETIC_TEST_SEED = 3;

const pick = (r: { suggestions: { gearId: string }[] }) =>
    r.suggestions.find((s) => s.gearId)?.gearId;

describe('every registered strategy forwards the custom formula', () => {
    let mathRandomSpy: ReturnType<typeof vi.spyOn> | undefined;

    afterEach(() => {
        mathRandomSpy?.mockRestore();
        mathRandomSpy = undefined;
    });

    // Keyed to the AutogearAlgorithm enum, not to a list of strategy files, so a strategy
    // added later is covered without anyone remembering to extend this test.
    for (const algorithm of Object.values(AutogearAlgorithm)) {
        it(`${algorithm} picks a different piece for an attack formula than a speed formula`, async () => {
            clearScoreCache();
            const strategy = getAutogearStrategy(algorithm);

            if (algorithm === AutogearAlgorithm.Genetic) {
                // GeneticStrategy scores every candidate 0 when there is no usable
                // formula (a roleless build has nothing else to score against), which
                // collapses its selection to a bare Math.random() tie-break. Pinning
                // that sequence here makes a dropped-formula bug fail deterministically
                // instead of only some fraction of runs.
                mathRandomSpy = vi
                    .spyOn(Math, 'random')
                    .mockImplementation(createSeededRandom(GENETIC_TEST_SEED));

                // A strategy that drops customFormula scores every candidate with
                // undefined exactly like these two undefined-formula runs. Proving
                // that pair lands off the expected answer, under the same seed the
                // real assertions below use, is what makes GENETIC_TEST_SEED's
                // choice a measurement rather than a claim.
                const droppedFormulaAttack = await strategy.findOptimalGear(
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
                    undefined
                );
                clearScoreCache();
                const droppedFormulaSpeed = await strategy.findOptimalGear(
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
                    undefined
                );
                const wouldPassIfDropped =
                    pick(droppedFormulaAttack) === 'gear-attack' &&
                    pick(droppedFormulaSpeed) === 'gear-speed';
                expect(wouldPassIfDropped).toBe(false);

                mathRandomSpy.mockImplementation(createSeededRandom(GENETIC_TEST_SEED));
            }

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

            expect(pick(forAttack)).toBe('gear-attack');
            expect(pick(forSpeed)).toBe('gear-speed');
        });
    }
});
