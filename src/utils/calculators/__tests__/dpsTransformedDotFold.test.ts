/**
 * Damage an enemy converts into a self-DoT is folded into the DPS page's DIRECT row.
 *
 * `dpsSimulator` derives Direct by SUBTRACTION — `perTargetDealt` minus the channels that have
 * their own tooltip row (corrosion, inferno, detonation). Generic ticks were subtracted off too
 * and then displayed nowhere, so once the engine started crediting a transformed hit to the
 * attacker the damage would have been carved out of Direct and vanished again.
 *
 * Owner ruling: the transformed damage belongs in the normal Direct total, not in a fifth row.
 * So `genericDamage` is NOT part of the `nonDirect` subtrahend, and `RoundData.genericDamage`
 * stays as the diagnostic record of how much of Direct arrived that way.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { realEnemyInput, REAL_ENEMY_ID } from '../__testutils__/dpsRealEnemyFixture';
import type { Ability } from '../../../types/abilities';

const transform: Ability = {
    id: 'enemy-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: 3, condition: 'always' },
};

const transformingEnemy = () => [
    {
        id: REAL_ENEMY_ID,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: 50,
            defence: 1000,
            hp: 5_000_000,
            security: 100,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: { slots: [{ slot: 'passive' as const, abilities: [transform] }] },
    },
];

describe('a transforming enemy does not swallow the focus’s Direct row', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('reports the transformed ticks as Direct damage', () => {
        const { rounds, summary } = simulateDPS(
            realEnemyInput({ rounds: 6, enemyAttackers: transformingEnemy() })
        );

        // ANTI-VACUITY: the transform really fired, so this run's damage IS generic ticks.
        const ticking = rounds.filter((r) => (r.genericDamage ?? 0) > 0);
        expect(ticking.length).toBeGreaterThan(0);

        // Every ticking round shows that damage on the Direct row rather than losing it.
        for (const r of ticking)
            expect(r.directDamage).toBeGreaterThanOrEqual(r.genericDamage ?? 0);
        expect(summary.totalDirectDamage).toBeGreaterThan(0);
    });

    it('keeps the four tooltip rows summing to the round total', () => {
        const { rounds } = simulateDPS(
            realEnemyInput({ rounds: 6, enemyAttackers: transformingEnemy() })
        );

        expect(rounds.filter((r) => (r.genericDamage ?? 0) > 0).length).toBeGreaterThan(0);
        for (const r of rounds) {
            // No `genericDamage` term: it is already inside `directDamage`, so adding it here
            // would double-count it.
            const parts = r.directDamage + r.corrosionDamage + r.infernoDamage + r.detonationDamage;
            expect(Math.abs(parts - r.totalRoundDamage)).toBeLessThanOrEqual(2);
        }
    });
});
