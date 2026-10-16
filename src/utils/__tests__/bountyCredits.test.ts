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
        const r = evaluateLevel(fixture, fenri, { ...keepAll, generalSellPct: 100 }, 40, {
            mode: 'normal',
            secondsPerFight: null,
            overheadSeconds: 5,
        });
        expect(r.fixedCredits).toBe(21000);
        expect(r.saleCredits).toBeCloseTo(0.5 * 4950);
    });

    it('keeping everything earns only the fixed credits', () => {
        const r = evaluateLevel(fixture, fenri, keepAll, 0, {
            mode: 'normal',
            secondsPerFight: null,
            overheadSeconds: 5,
        });
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
            { mode: 'normal', secondsPerFight: null, overheadSeconds: 5 }
        );
        // P(sold) = 1/3 * 1 + 2/3 * 0.5 = 2/3
        expect(r.saleCredits).toBeCloseTo(0.5 * (2 / 3) * 4950);
        expect(r.keptGearPerRun).toBeCloseTo(0.5 * (1 / 3));
    });

    it('a sold set counts for 1/4 of drops at L33', () => {
        const l33 = { ...fixture, level: 33 };
        const r = evaluateLevel(l33, fenri, { ...keepAll, sets: ['Burner'] }, 0, {
            mode: 'normal',
            secondsPerFight: null,
            overheadSeconds: 5,
        });
        expect(r.saleCredits).toBeCloseTo(0.5 * 0.25 * 4950);
    });

    it('derives per-energy and per-minute', () => {
        const r = evaluateLevel(fixture, fenri, keepAll, 0, {
            mode: 'normal',
            secondsPerFight: 55,
            overheadSeconds: 5,
        });
        expect(r.perEnergy).toBe(1500);
        expect(r.perMinute).toBe(15000); // one 60 s cycle per minute
        expect(
            evaluateLevel(fixture, fenri, keepAll, 0, {
                mode: 'normal',
                secondsPerFight: null,
                overheadSeconds: 5,
            }).perMinute
        ).toBeNull();
    });

    it('sells everything on real L33 data', () => {
        const l33 = BOUNTY_LEVELS[32];
        const r = evaluateLevel(l33, fenri, { ...keepAll, generalSellPct: 100 }, 0, {
            mode: 'normal',
            secondsPerFight: null,
            overheadSeconds: 5,
        });
        expect(r.keptGearPerRun).toBeCloseTo(0);
        expect(r.saleCredits).toBeGreaterThan(4000);
    });
});

describe('bestLevels', () => {
    it('ranks best-first and drops levels without a per-minute value', () => {
        const a = evaluateLevel(BOUNTY_LEVELS[31], fenri, keepAll, 0, {
            mode: 'normal',
            secondsPerFight: 60,
            overheadSeconds: 5,
        });
        const b = evaluateLevel(BOUNTY_LEVELS[32], fenri, keepAll, 0, {
            mode: 'normal',
            secondsPerFight: null,
            overheadSeconds: 5,
        });
        expect(bestLevels([a, b], 'run').map((r) => r.level)).toEqual([33, 32]);
        expect(bestLevels([a, b], 'minute').map((r) => r.level)).toEqual([32]);
    });
});

describe('evaluateLevel — background', () => {
    const fixture: BountyLevel = {
        level: 32,
        credits: 15000,
        energy: 10,
        totalGearChance: 50,
        drops: [{ stars: 5, rarity: 'rare', chance: 50 }],
    };

    it('pays 90% energy and earns per tier minute', () => {
        const r = evaluateLevel(fixture, fenri, keepAll, 0, { mode: 'background', tier: 'win' });
        expect(r.energy).toBeCloseTo(9);
        expect(r.perEnergy).toBeCloseTo(15000 / 9);
        expect(r.perMinute).toBeCloseTo(15000 / 6);
    });

    it('adds one normalized bonus gear per 10 battles at the 1-round tier', () => {
        const sellAll = { ...keepAll, generalSellPct: 100 };
        const r = evaluateLevel(fixture, fenri, sellAll, 0, { mode: 'background', tier: 'r1' });
        // regular 0.5 × 4950 + bonus 0.1 × 4950 (the extra drop is always a gear)
        expect(r.saleCredits).toBeCloseTo(0.6 * 4950);
        expect(r.perMinute).toBeCloseTo(r.total);
        const kept = evaluateLevel(fixture, fenri, keepAll, 0, { mode: 'background', tier: 'r1' });
        expect(kept.keptGearPerRun).toBeCloseTo(0.6);
    });

    it('bonus rates follow the tier', () => {
        const sellAll = { ...keepAll, generalSellPct: 100 };
        const sale = (tier: 'r3' | 'r5' | 'r10') =>
            evaluateLevel(fixture, fenri, sellAll, 0, { mode: 'background', tier }).saleCredits;
        expect(sale('r3')).toBeCloseTo((0.5 + 1 / 15) * 4950);
        expect(sale('r5')).toBeCloseTo((0.5 + 1 / 20) * 4950);
        expect(sale('r10')).toBeCloseTo(0.5 * 4950);
    });

    it('real L33 background energy is 9.9', () => {
        const r = evaluateLevel(BOUNTY_LEVELS[32], fenri, keepAll, 0, {
            mode: 'background',
            tier: 'win',
        });
        expect(r.energy).toBeCloseTo(9.9);
    });

    it('skips the bonus gear when the level has no gear drops', () => {
        const noGear: BountyLevel = { ...fixture, totalGearChance: 0, drops: [] };
        const r = evaluateLevel(noGear, fenri, keepAll, 0, { mode: 'background', tier: 'r1' });
        expect(r.saleCredits).toBe(0);
        expect(r.keptGearPerRun).toBe(0);
    });
});
