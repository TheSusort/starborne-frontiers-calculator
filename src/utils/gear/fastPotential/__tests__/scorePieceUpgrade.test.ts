import { describe, it, expect } from 'vitest';
import { scoreCurrentWithShip, scorePieceApplied } from '../scorePieceUpgrade';
import { buildPotentialContext } from '../potentialContext';
import { calculatePriorityScore } from '../../../autogear/scoring';
import type { GearPiece } from '../../../../types/gear';
import type { Ship } from '../../../../types/ship';

function makeMinimalPiece(id: string, slot: string): GearPiece {
    return {
        id,
        slot: slot,
        setBonus: null,
        rarity: 'legendary',
        level: 0,
        stars: 6,
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
    } as GearPiece;
}

function makeShip(): Ship {
    return {
        id: 'ship-a',
        type: 'ATTACKER',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        name: 'TestShip',
        baseStats: {
            hp: 20000,
            attack: 5000,
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
        refits: [],
        equipment: {},
        implants: {},
    } as Ship;
}

describe('scoreCurrentWithShip', () => {
    it('equals calculatePriorityScore(baseline.final) + mainStat bonus', () => {
        const ship = makeShip();
        const piece = makeMinimalPiece('g1', 'weapon');
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: ['attack'],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });

        const actual = scoreCurrentWithShip(ctx, piece, 'weapon');
        const expectedBase = calculatePriorityScore(ship.baseStats, [], 'ATTACKER');
        const expectedWithBonus = expectedBase + expectedBase * 0.5;
        expect(actual).toBeCloseTo(expectedWithBonus, 6);
    });

    it('returns bare baseScore when no selectedStats match', () => {
        const ship = makeShip();
        const piece = makeMinimalPiece('g1', 'weapon');
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: ['hp'], // piece's main is attack, no match
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        const actual = scoreCurrentWithShip(ctx, piece, 'weapon');
        const expected = calculatePriorityScore(ship.baseStats, [], 'ATTACKER');
        expect(actual).toBeCloseTo(expected, 6);
    });
});

describe('scorePieceApplied — dummy mode', () => {
    it('matches calculateGearStats + calculatePriorityScore for a lone piece', async () => {
        const piece: GearPiece = {
            id: 'g1',
            slot: 'weapon',
            setBonus: null,
            rarity: 'legendary',
            level: 0,
            stars: 6,
            mainStat: { name: 'attack', value: 200, type: 'flat' },
            subStats: [{ name: 'hp', value: 500, type: 'flat' }],
        } as GearPiece;
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });

        // Slow path: ATTACKER role base + piece applied (no set bonus).
        const { analyzePotentialUpgrades } = await import('../../potentialCalculator');
        const [slowResult] = analyzePotentialUpgrades(
            [piece],
            'ATTACKER',
            1,
            undefined,
            'rare',
            1,
            [],
            'AND',
            [],
            undefined,
            undefined,
            undefined
        );

        const fastScore = scorePieceApplied(ctx, piece, 'weapon');
        // currentScore is computed from the original piece (not the simulated upgrade).
        // The fast path's dummy mode applies the same logic: role base + piece stats.
        expect(fastScore).toBeCloseTo(slowResult.currentScore, 5);
    });
});

describe('scorePieceApplied — set bonus (with-ship deltaful)', () => {
    it('applies set bonus only when crossing minPieces threshold', () => {
        // Build a ship with 1 ATTACK piece equipped in "hull" (not weapon).
        // ATTACK has minPieces=2 (default) and stats: [{attack: 15%, percentage}].
        const equippedHull: GearPiece = {
            id: 'h1',
            slot: 'hull',
            setBonus: 'ATTACK' as GearPiece['setBonus'],
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: { name: 'hp', value: 100, type: 'flat' },
            subStats: [],
        } as GearPiece;
        const shipWithOne: Ship = {
            id: 'ship-s1',
            type: 'ATTACKER',
            rarity: 'legendary',
            faction: 'TERRAN_COMBINE',
            name: 'TestShip',
            baseStats: {
                hp: 20000,
                attack: 5000,
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
            refits: [],
            implants: {},
            equipment: { hull: 'h1' },
        } as Ship;
        const incoming: GearPiece = {
            id: 'w1',
            slot: 'weapon',
            setBonus: 'ATTACK' as GearPiece['setBonus'],
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: { name: 'attack', value: 100, type: 'flat' },
            subStats: [],
        } as GearPiece;
        const pieceLookup = new Map<string, GearPiece>([['h1', equippedHull]]);

        const ctx = buildPotentialContext({
            inventory: [incoming],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship: shipWithOne,
            getGearPiece: (id) => pieceLookup.get(id),
            getEngineeringStatsForShipType: () => undefined,
        });

        // Count before = 1 (hull). Count after adding incoming (weapon) = 2.
        // ATTACK minPieces = 2 => crosses threshold. The scorer must
        // apply the set bonus at least once; we assert the score is strictly
        // greater than a same-piece-without-setBonus version.
        const scoreWithSet = scorePieceApplied(ctx, incoming, 'weapon');
        const noSet: GearPiece = { ...incoming, setBonus: null };
        const scoreNoSet = scorePieceApplied(ctx, noSet, 'weapon');
        expect(scoreWithSet).toBeGreaterThan(scoreNoSet);
    });
});

describe('scorePieceApplied — calibration (with-ship only)', () => {
    it('substitutes calibrated main stat when piece.calibration.shipId matches', () => {
        // Build a calibration-eligible piece (level>=16, stars>=5) that is
        // calibrated to the target ship. Compare against the same piece
        // without calibration — calibrated score must be strictly higher
        // (calibration boosts the main stat).
        const baseStat = { name: 'attack' as const, value: 500, type: 'flat' as const };
        const piece: GearPiece = {
            id: 'c1',
            slot: 'weapon',
            setBonus: null,
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: baseStat,
            subStats: [],
            calibration: { shipId: 'ship-c', level: 1 },
        } as GearPiece;
        const uncalibrated: GearPiece = { ...piece, calibration: undefined };

        const ship: Ship = {
            id: 'ship-c',
            type: 'ATTACKER',
            rarity: 'legendary',
            faction: 'TERRAN_COMBINE',
            name: 'TestShip',
            baseStats: {
                hp: 20000,
                attack: 5000,
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
            refits: [],
            implants: {},
            equipment: {},
        } as Ship;

        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });

        const calibrated = scorePieceApplied(ctx, piece, 'weapon');
        const plain = scorePieceApplied(ctx, uncalibrated, 'weapon');
        expect(calibrated).toBeGreaterThan(plain);
    });
});
