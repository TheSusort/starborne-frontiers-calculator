import { describe, it, expect } from 'vitest';
import { scoreCurrentWithShip, scorePieceApplied } from '../scorePieceUpgrade';
import { buildPotentialContext } from '../potentialContext';
import { analyzePotentialUpgrades } from '../../potentialCalculator';
import { calculatePriorityScore } from '../../../autogear/scoring';
import type { GearPiece } from '../../../../types/gear';
import { makeMinimalPiece, makeShip } from './fixtures';

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
    it('matches calculateGearStats + calculatePriorityScore for a lone piece', () => {
        const piece: GearPiece = {
            ...makeMinimalPiece('g1', 'weapon'),
            mainStat: { name: 'attack', value: 200, type: 'flat' },
            subStats: [{ name: 'hp', value: 500, type: 'flat' }],
        };
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
        // ATTACK has minPieces=2 (default) and stats: [{attack: 15%, percentage}].
        // Ship has 1 ATTACK piece in hull → incoming ATTACK piece in weapon
        // brings count to 2, crossing the threshold.
        const equippedHull: GearPiece = {
            ...makeMinimalPiece('h1', 'hull', 'ATTACK'),
            level: 16,
            mainStat: { name: 'hp', value: 100, type: 'flat' },
        };
        const shipWithOne = makeShip({
            id: 'ship-s1',
            equipment: { hull: 'h1' },
        });
        const incoming: GearPiece = {
            ...makeMinimalPiece('w1', 'weapon', 'ATTACK'),
            level: 16,
        };
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
        const piece: GearPiece = {
            ...makeMinimalPiece('c1', 'weapon'),
            level: 16,
            mainStat: { name: 'attack', value: 500, type: 'flat' },
            calibration: { shipId: 'ship-c' },
        };
        const uncalibrated: GearPiece = { ...piece, calibration: undefined };
        const ship = makeShip({ id: 'ship-c' });

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
