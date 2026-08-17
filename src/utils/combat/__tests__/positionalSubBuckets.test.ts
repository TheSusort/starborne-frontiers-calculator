/**
 * The `secondary` / `conditional` display sub-buckets are accumulated inside the same
 * `if (!positional)` guard that suppresses the direct CREDIT — but unlike the credit they feed
 * nothing but `rawTotals` (one write per side, one read at engine.ts:9991-9992). So a positional
 * run reported 0 for both, and ShipConfigSummary's `> 0`-guarded rows silently vanished.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import type { ShipSkills } from '../../../types/abilities';
import { bareInput } from '../__testutils__/bareRosterFixture';

/**
 * Active slot: a firing hit plus an `additional-damage` ability — that is what
 * `secondaryFromSkill` (applyAbilities.ts:224) maps into `turn.secondaryDamage`. It scales off the
 * CASTER's own stat (`stat: 'hp'` → `effectiveHp`, playerTurn.ts:2402-2418), so the fixture's focus
 * must carry non-zero HP or the sub-bucket is 0 for a reason that has nothing to do with this fix.
 * `bareInput()` supplies `hp: 1_000_000`.
 */
const secondaryKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 's1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                {
                    id: 's2',
                    type: 'additional-damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'additional-damage', stat: 'hp', pct: 20 },
                },
            ],
        },
    ],
});

const input = (): CombatEngineInput => ({ ...bareInput(), shipSkills: secondaryKit() });

describe('display sub-buckets on a positional run', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('reports the secondary component the cast actually dealt', () => {
        const { rawTotals } = runCombat(input());
        expect(rawTotals.totalSecondary).toBeGreaterThan(0);
    });

    it('reports the sub-bucket as a VIEW of the damage dealt, not an addition to it', () => {
        const { rounds, rawTotals } = runCombat(input());
        const dealt = rounds
            .flatMap((r) => Object.values(r.perTargetDealt?.['attacker'] ?? {}))
            .reduce((s, n) => s + n, 0);

        expect(dealt).toBeGreaterThan(0);
        expect(rawTotals.totalSecondary).toBeGreaterThan(0);
        // The secondary component is part of the firing hit the victim already took. If it ever
        // exceeds the total dealt it has stopped being a view and started being its own damage.
        expect(rawTotals.totalSecondary).toBeLessThan(dealt);
    });
});
