/**
 * SP-4b-2a: a DPS caller that supplies no roster still fights a real, positioned enemy. Before
 * this, the focus fired into the dummy sink: `perTargetDealt` came back EMPTY while the damage
 * total looked plausible, and the legacyVictim fallback (SP-4c's keystone) was consulted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, SYNTHESIZED_DPS_ENEMY_ID } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import {
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
} from '../../combat/engine';
import { baseInput } from '../__testutils__/dpsRealEnemyFixture';

describe('the DPS calculator never runs without an enemy', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('routes a scalar-only input per-victim onto a synthesized enemy', () => {
        const { rounds } = simulateDPS(baseInput());

        const dealt = rounds.flatMap((r) =>
            Object.entries(r.perTargetDealt ?? {}).flatMap(([source, byVictim]) =>
                Object.entries(byVictim).map(([victim, amount]) => ({ source, victim, amount }))
            )
        );
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.every((d) => d.victim === SYNTHESIZED_DPS_ENEMY_ID)).toBe(true);
        expect(dealt.some((d) => d.amount > 0)).toBe(true);
    });

    it('never consults the legacyVictim fallback', () => {
        simulateDPS(baseInput());
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('carries the caller scalars onto the synthesized enemy', () => {
        // Defence is the observable: doubling it must reduce the damage. If the synthesized enemy
        // ignored `enemyDefense`, both runs would be identical.
        const soft = simulateDPS(baseInput({ enemyDefense: 0 })).summary.totalDamage;
        setupKeyedTestRng(12345);
        const armoured = simulateDPS(baseInput({ enemyDefense: 20_000 })).summary.totalDamage;
        expect(armoured).toBeLessThan(soft);
    });

    it('lets the enemy die and trims the reported rounds to the kill', () => {
        const result = simulateDPS(baseInput({ enemyHp: 20_000, rounds: 6 }));
        expect(result.summary.survived).toBe(false);
        expect(result.summary.roundsToKill).toBeDefined();
        expect(result.rounds.length).toBe(result.summary.roundsToKill);
    });
});
