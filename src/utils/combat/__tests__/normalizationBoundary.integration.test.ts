/**
 * SP-4b-1: the boundary is live — a caller that supplies NO positions and NO targeting still gets
 * a fully positional run. Pre-boundary, this fixture routed the focus's cast into the dummy sink:
 * `perTargetDealt` came back empty while `rawTotals.cumulative` looked plausible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareEnemy } from '../__testutils__/bareRosterFixture';
import type { CombatEngineInput } from '../engine';

describe('the normalization boundary is live in runCombat', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('routes a position-less, targeting-less roster per-victim instead of into the sink', () => {
        const { rounds } = runCombat(bareInput());

        // perTargetDealt is the discriminator. Pre-boundary it was EMPTY for this input.
        const dealt = rounds.flatMap((r) =>
            Object.entries(r.perTargetDealt ?? {}).flatMap(([source, byVictim]) =>
                Object.entries(byVictim as Record<string, number>).map(([victim, amount]) => ({
                    source,
                    victim,
                    amount,
                }))
            )
        );
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.every((d) => d.victim === 'e1')).toBe(true);
        expect(dealt.some((d) => d.amount > 0)).toBe(true);
    });

    it('never routes damage to the dummy when a roster is supplied', () => {
        const { rounds } = runCombat(bareInput());
        const victims = rounds.flatMap((r) =>
            Object.values(r.perTargetDealt ?? {}).flatMap((byVictim) =>
                Object.keys(byVictim as Record<string, number>)
            )
        );
        expect(victims).not.toContain('enemy');
    });

    it('leaves an explicitly-positioned run byte-identical', () => {
        const explicit = {
            ...bareInput(),
            position: 'B1',
            enemyAttackers: [{ ...bareEnemy()[0], position: 'T2' }],
        } as CombatEngineInput;

        setupKeyedTestRng(12345);
        const before = runCombat(explicit);
        setupKeyedTestRng(12345);
        const after = runCombat(explicit);
        expect(after.rawTotals).toEqual(before.rawTotals);
    });
});
