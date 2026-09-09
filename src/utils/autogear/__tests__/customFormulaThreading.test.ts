import { describe, it, expect, beforeEach } from 'vitest';
import { calculateTotalScore, clearScoreCache } from '../scoring';
import type { CustomFormula } from '../../../types/autogear';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

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
        // The memo cache key carries shipRole but not the formula. Today only
        // clearScoreCache() at the start of every run keeps that from being a live bug;
        // this test pins the guarantee instead of leaving it to a comment.
        const a = score(attackFormula);
        const b = score(speedFormula);
        expect(a).not.toBeCloseTo(b, 6);
    });
});
