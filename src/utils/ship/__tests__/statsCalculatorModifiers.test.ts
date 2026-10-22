import { describe, it, expect } from 'vitest';
import { calculateTotalStats } from '../statsCalculator';
import { GearPiece } from '../../../types/gear';
import { BaseStats, EngineeringStat, Stat } from '../../../types/stats';
import { Refit } from '../../../types/ship';

const BASE_STATS: BaseStats = {
    hp: 10000,
    attack: 10000,
    defence: 5000,
    hacking: 1000,
    security: 2000,
    speed: 100,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    defensePenetration: 0,
};

const ENGINEERING_FLAT_ATTACK: EngineeringStat = {
    shipType: 'ATTACKER',
    stats: [{ name: 'attack', value: 1000, type: 'flat' }],
};

let pieceSeq = 0;
const makePiece = (overrides: Partial<GearPiece>): GearPiece => ({
    id: `piece-${++pieceSeq}`,
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: null,
    subStats: [],
    setBonus: null,
    ...overrides,
});

const lookupFrom =
    (pieces: GearPiece[]) =>
    (id: string): GearPiece | undefined =>
        pieces.find((p) => p.id === id);

const withSubStat = (stat: Stat, overrides: Partial<GearPiece> = {}) =>
    makePiece({ subStats: [stat], ...overrides });

describe('calculateTotalStats — percentage reference per stage', () => {
    it('scales each percentage refit stat off the raw base stat, without compounding', () => {
        const refits: Refit[] = [
            { id: 'r1', stats: [{ name: 'attack', value: 5, type: 'percentage' }] },
            { id: 'r2', stats: [{ name: 'attack', value: 5, type: 'percentage' }] },
        ];
        const result = calculateTotalStats(
            BASE_STATS,
            {},
            () => undefined,
            refits,
            {},
            ENGINEERING_FLAT_ATTACK
        );
        expect(result.afterRefits.attack).toBe(11000);
        expect(result.final.attack).toBe(12000);
    });

    it('scales a percentage gear sub stat off the post-engineering stat', () => {
        const piece = withSubStat({ name: 'attack', value: 10, type: 'percentage' });
        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: piece.id },
            lookupFrom([piece]),
            [],
            {},
            ENGINEERING_FLAT_ATTACK
        );
        expect(result.afterEngineering.attack).toBe(11000);
        expect(result.afterGear.attack).toBe(11000 + 1100);
    });

    it('scales a percentage implant sub stat off the post-engineering stat, not post-gear', () => {
        const gear = withSubStat({ name: 'attack', value: 5000, type: 'flat' });
        const implant = withSubStat(
            { name: 'attack', value: 10, type: 'percentage' },
            { slot: 'implant_minor_alpha' }
        );
        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: gear.id },
            lookupFrom([gear, implant]),
            [],
            { implant_minor_alpha: implant.id },
            ENGINEERING_FLAT_ATTACK
        );
        expect(result.afterSets.attack).toBe(16000);
        expect(result.final.attack).toBe(16000 + 1100);
    });

    it('adds a percentage-only stat as points rather than scaling it', () => {
        const piece = withSubStat({ name: 'crit', value: 10, type: 'percentage' });
        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: piece.id },
            lookupFrom([piece]),
            [],
            {},
            undefined
        );
        expect(result.final.crit).toBe(60);
    });
});

describe('calculateTotalStats — set bonuses', () => {
    const attackSetPieces = (n: number) =>
        Array.from({ length: n }, () => makePiece({ setBonus: 'ATTACK' }));
    const slots = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;
    const equip = (pieces: GearPiece[]) =>
        Object.fromEntries(pieces.map((p, i) => [slots[i], p.id]));

    it.each([
        [1, 0],
        [2, 1],
        [3, 1],
        [4, 2],
    ])('%i ATTACK pieces apply the set bonus %i time(s)', (count, bonuses) => {
        const pieces = attackSetPieces(count);
        const result = calculateTotalStats(
            BASE_STATS,
            equip(pieces),
            lookupFrom(pieces),
            [],
            {},
            ENGINEERING_FLAT_ATTACK
        );
        // Each bonus is 15% of the post-engineering attack (11000).
        expect(result.afterSets.attack).toBeCloseTo(11000 + bonuses * 1650, 6);
    });
});

describe('calculateTotalStats — stat-converting ultimate implants', () => {
    const ultimate = (setBonus: string, rarity: string) =>
        makePiece({
            slot: 'implant_ultimate',
            setBonus: setBonus,
            rarity: rarity as GearPiece['rarity'],
        });

    const finalWith = (implant: GearPiece, gear: GearPiece[] = []) =>
        calculateTotalStats(
            BASE_STATS,
            Object.fromEntries(gear.map((g, i) => [i === 0 ? 'weapon' : 'hull', g.id])),
            lookupFrom([implant, ...gear]),
            [],
            { implant_ultimate: implant.id },
            undefined
        ).final;

    it.each([
        ['common', 20],
        ['uncommon', 25],
        ['rare', 30],
        ['epic', 35],
        ['legendary', 40],
    ])('a %s CODE_GUARD adds %i percent of hacking to security', (rarity, pct) => {
        const final = finalWith(ultimate('CODE_GUARD', rarity));
        expect(final.hacking).toBe(1000);
        expect(final.security).toBeCloseTo(2000 + 1000 * (pct / 100), 6);
    });

    it.each([
        ['common', 20],
        ['uncommon', 25],
        ['rare', 31],
        ['epic', 37],
        ['legendary', 45],
    ])('a %s CIPHER_LINK adds %i percent of security to hacking', (rarity, pct) => {
        const final = finalWith(ultimate('CIPHER_LINK', rarity));
        expect(final.security).toBe(2000);
        expect(final.hacking).toBeCloseTo(1000 + 2000 * (pct / 100), 6);
    });

    it('CODE_GUARD reads hacking after gear has been applied', () => {
        const hackingGear = withSubStat({ name: 'hacking', value: 500, type: 'flat' });
        const final = finalWith(ultimate('CODE_GUARD', 'epic'), [hackingGear]);
        expect(final.security).toBeCloseTo(2000 + 1500 * 0.35, 6);
    });

    it('a converting implant of an unknown rarity changes nothing', () => {
        const final = finalWith(ultimate('CODE_GUARD', 'mythic'));
        expect(final.security).toBe(2000);
        expect(final.hacking).toBe(1000);
    });

    it('an ultimate implant without a conversion leaves hacking and security alone', () => {
        const final = finalWith(ultimate('WARPSTRIKE', 'legendary'));
        expect(final.security).toBe(2000);
        expect(final.hacking).toBe(1000);
    });
});
