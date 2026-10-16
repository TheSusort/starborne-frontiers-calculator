import { describe, it, expect } from 'vitest';
import { BOUNTIES, BOUNTY_LEVELS, BountyLevel } from '../../constants/bounties';
import {
    gearSellPrice,
    setsAtLevel,
    availableLevels,
    isAutoSold,
    evaluateLevel,
    bestLevels,
    SellRules,
} from '../bountyCredits';

const fenri = BOUNTIES.find((b) => b.id === 'fenri')!;
const eelun = BOUNTIES.find((b) => b.id === 'eelun')!;
const keepAll: SellRules = { stars: [], rarities: [], sets: [], generalSellPct: 0 };

describe('gearSellPrice', () => {
    it('matches every owner-supplied in-game price', () => {
        const known: [
            1 | 2 | 3 | 4 | 5 | 6,
            'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
            number,
        ][] = [
            [6, 'legendary', 7560],
            [6, 'epic', 7182],
            [6, 'rare', 6930],
            [5, 'legendary', 5400],
            [5, 'epic', 5130],
            [5, 'rare', 4950],
            [4, 'legendary', 3780],
            [4, 'epic', 3591],
            [4, 'rare', 3465],
            [3, 'legendary', 2700],
            [3, 'epic', 2565],
            [3, 'rare', 2475],
            [3, 'uncommon', 2250],
            [2, 'common', 1620],
            [1, 'uncommon', 1350],
            [1, 'common', 1215],
        ];
        for (const [s, r, price] of known) expect(gearSellPrice(s, r), `${s}★ ${r}`).toBe(price);
    });
});

describe('sets and levels', () => {
    it('adds the abyssal set only at L33', () => {
        expect(setsAtLevel(fenri, 32)).toEqual(['Attack', 'Speed', 'Critical']);
        expect(setsAtLevel(fenri, 33)).toEqual(['Attack', 'Speed', 'Critical', 'Burner']);
    });

    it('hides L33 for a bounty whose abyssal level is unreleased', () => {
        expect(availableLevels(fenri)).toHaveLength(33);
        expect(availableLevels(eelun).map((l) => l.level)).not.toContain(33);
    });
});

describe('isAutoSold (in-game OR filter)', () => {
    const rules: SellRules = { stars: [4], rarities: ['rare'], sets: ['Speed'], generalSellPct: 0 };
    it('sells on star OR rarity OR set', () => {
        expect(isAutoSold({ stars: 4, rarity: 'legendary', chance: 1 }, 'Attack', rules)).toBe(
            true
        );
        expect(isAutoSold({ stars: 6, rarity: 'rare', chance: 1 }, 'Attack', rules)).toBe(true);
        expect(isAutoSold({ stars: 6, rarity: 'legendary', chance: 1 }, 'Speed', rules)).toBe(true);
        expect(isAutoSold({ stars: 6, rarity: 'legendary', chance: 1 }, 'Attack', rules)).toBe(
            false
        );
    });
});

describe('evaluateLevel', () => {
    const fixture: BountyLevel = {
        level: 32,
        credits: 15000,
        energy: 10,
        totalGearChance: 50,
        drops: [{ stars: 5, rarity: 'rare', chance: 50 }],
    };

    it('scales fixed credits only by the extra credits %', () => {
        const r = evaluateLevel(fixture, fenri, { ...keepAll, generalSellPct: 100 }, 40, null, 5);
        expect(r.fixedCredits).toBe(21000);
        expect(r.saleCredits).toBeCloseTo(0.5 * 4950);
    });

    it('keeping everything earns only the fixed credits', () => {
        const r = evaluateLevel(fixture, fenri, keepAll, 0, null, 5);
        expect(r.saleCredits).toBe(0);
        expect(r.total).toBe(15000);
        expect(r.keptGearPerRun).toBeCloseTo(0.5);
    });

    it('a sold set counts for 1/3 of drops at L1-32 and the general % applies to the rest', () => {
        const r = evaluateLevel(
            fixture,
            fenri,
            { ...keepAll, sets: ['Speed'], generalSellPct: 50 },
            0,
            null,
            5
        );
        // P(sold) = 1/3 * 1 + 2/3 * 0.5 = 2/3
        expect(r.saleCredits).toBeCloseTo(0.5 * (2 / 3) * 4950);
        expect(r.keptGearPerRun).toBeCloseTo(0.5 * (1 / 3));
    });

    it('a sold set counts for 1/4 of drops at L33', () => {
        const l33 = { ...fixture, level: 33 };
        const r = evaluateLevel(l33, fenri, { ...keepAll, sets: ['Burner'] }, 0, null, 5);
        expect(r.saleCredits).toBeCloseTo(0.5 * 0.25 * 4950);
    });

    it('derives per-energy and per-minute', () => {
        const r = evaluateLevel(fixture, fenri, keepAll, 0, 55, 5);
        expect(r.perEnergy).toBe(1500);
        expect(r.perMinute).toBe(15000); // one 60 s cycle per minute
        expect(evaluateLevel(fixture, fenri, keepAll, 0, null, 5).perMinute).toBeNull();
    });

    it('sells everything on real L33 data', () => {
        const l33 = BOUNTY_LEVELS[32];
        const r = evaluateLevel(l33, fenri, { ...keepAll, generalSellPct: 100 }, 0, null, 5);
        expect(r.keptGearPerRun).toBeCloseTo(0);
        expect(r.saleCredits).toBeGreaterThan(4000);
    });
});

describe('bestLevels', () => {
    it('ranks best-first and drops levels without a per-minute value', () => {
        const a = evaluateLevel(BOUNTY_LEVELS[31], fenri, keepAll, 0, 60, 5);
        const b = evaluateLevel(BOUNTY_LEVELS[32], fenri, keepAll, 0, null, 5);
        expect(bestLevels([a, b], 'run').map((r) => r.level)).toEqual([33, 32]);
        expect(bestLevels([a, b], 'minute').map((r) => r.level)).toEqual([32]);
    });
});
