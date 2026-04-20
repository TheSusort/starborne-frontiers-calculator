import { describe, it, expect } from 'vitest';
import { scoreCurrentWithShip } from '../scorePieceUpgrade';
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
