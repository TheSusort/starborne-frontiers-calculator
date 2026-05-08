import { describe, it, expect, vi } from 'vitest';
import { optimizeEngineering } from '../engineeringOptimizer';
import type { Ship } from '../../../types/ship';
import type { EngineeringStats } from '../../../types/stats';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
    id: 'ship-1',
    name: 'Test Ship',
    type: 'ATTACKER',
    rarity: 'epic',
    faction: 'ATLAS_SYNDICATE',
    baseStats: {
        hp: 100000,
        attack: 50000,
        defence: 30000,
        hacking: 0,
        security: 0,
        crit: 50,
        critDamage: 150,
        speed: 100,
        hpRegen: 0,
        shield: 0,
        healModifier: 0,
        damageReduction: 0,
        defensePenetration: 0,
        shieldPenetration: 0,
    },
    equipment: {},
    implants: {},
    refits: [],
    starred: true,
    copies: 1,
    level: 60,
    rank: 1,
    ...overrides,
});

const emptyEngineering: EngineeringStats = { stats: [] };
const mockGetGearPiece = vi.fn(() => undefined);

describe('optimizeEngineering', () => {
    it('returns empty recommendations when budget is 0', () => {
        const result = optimizeEngineering(0, [makeShip()], emptyEngineering, mockGetGearPiece);
        expect(result.recommendations).toHaveLength(0);
        expect(result.tokensUsed).toBe(0);
    });

    it('returns empty recommendations when there are no starred ships', () => {
        const unstarred = makeShip({ starred: false });
        const result = optimizeEngineering(10000, [unstarred], emptyEngineering, mockGetGearPiece);
        expect(result.recommendations).toHaveLength(0);
    });

    it('recommends at least one upgrade when budget covers it', () => {
        const result = optimizeEngineering(100, [makeShip()], emptyEngineering, mockGetGearPiece);
        expect(result.recommendations.length).toBeGreaterThan(0);
        expect(result.tokensUsed).toBeLessThanOrEqual(100);
    });

    it('only recommends upgrades for roles with starred ships', () => {
        const result = optimizeEngineering(
            50000,
            [makeShip({ type: 'ATTACKER' })],
            emptyEngineering,
            mockGetGearPiece
        );
        const roles = result.recommendations.map((r) => r.role);
        const uniqueRoles = [...new Set(roles)];
        expect(uniqueRoles).toContain('ATTACKER');
        expect(uniqueRoles).not.toContain('DEFENDER');
        expect(uniqueRoles).not.toContain('DEBUFFER');
        expect(uniqueRoles).not.toContain('SUPPORTER');
    });

    it('respects the token budget — tokensUsed never exceeds budget', () => {
        const result = optimizeEngineering(3500, [makeShip()], emptyEngineering, mockGetGearPiece);
        expect(result.tokensUsed).toBeLessThanOrEqual(3500);
    });

    it('skips tracks already at max level (20)', () => {
        const maxedEngineering: EngineeringStats = {
            stats: [
                {
                    shipType: 'ATTACKER',
                    stats: [
                        { name: 'critDamage', value: 20, type: 'percentage' },
                        { name: 'attack', value: 20, type: 'percentage' },
                        { name: 'defence', value: 20, type: 'percentage' },
                        { name: 'hacking', value: 40, type: 'flat' },
                    ],
                },
            ],
        };
        const result = optimizeEngineering(
            100000,
            [makeShip()],
            maxedEngineering,
            mockGetGearPiece
        );
        const attackerRecs = result.recommendations.filter((r) => r.role === 'ATTACKER');
        expect(attackerRecs).toHaveLength(0);
    });

    it('ranks by value ratio descending', () => {
        const ships = [makeShip(), makeShip({ id: 'ship-2' })];
        const result = optimizeEngineering(100000, ships, emptyEngineering, mockGetGearPiece);
        for (let i = 1; i < result.recommendations.length; i++) {
            expect(result.recommendations[i - 1].valueRatio).toBeGreaterThanOrEqual(
                result.recommendations[i].valueRatio
            );
        }
    });

    it('computes roleImprovements as sum of percentImprovement per role', () => {
        const result = optimizeEngineering(10000, [makeShip()], emptyEngineering, mockGetGearPiece);
        if (result.recommendations.some((r) => r.role === 'ATTACKER')) {
            const expectedTotal = result.recommendations
                .filter((r) => r.role === 'ATTACKER')
                .reduce((sum, r) => sum + r.percentImprovement, 0);
            expect(result.roleImprovements['ATTACKER']).toBeCloseTo(expectedTotal, 5);
        }
    });
});
