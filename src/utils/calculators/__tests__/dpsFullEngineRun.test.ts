/**
 * #415: a DPS run must execute the full engine runtime — shields, leeches, repair-over-time,
 * `lowest-hp-ally` routing — while the healing REPORT stays absent. Before this, `healTarget` was
 * undefined in DPS mode, so `healingCtx` was never built and nine channels died from one line.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { baseInput, damageKit } from '../__testutils__/dpsRealEnemyFixture';
import type { ShipSkills } from '../../../types/abilities';
import { runCombat } from '../../combat/engine';
import { bareInput, bareEnemy } from '../../combat/__testutils__/bareRosterFixture';

/** A focus that damages AND shields itself for 20% of its own max HP on every cast. */
const selfShieldKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...damageKit().slots[0].abilities,
                {
                    id: 's1',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 20, basis: 'hp' },
                },
            ],
        },
    ],
});

describe('#415 the DPS calculator runs the full engine', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('grants and reports a shield', () => {
        const { rounds } = simulateDPS(
            baseInput({ shipSkills: selfShieldKit(), hp: 1_000_000, rounds: 3 })
        );
        const granted = rounds.map((r) => r.perActorShield?.attacker?.granted ?? 0);
        // 20% of 1,000,000 every round.
        expect(granted).toEqual([200_000, 200_000, 200_000]);
        // The pool compounds because nothing drains it at the 0-attack default.
        expect(rounds.map((r) => r.perActorShield?.attacker?.pool ?? 0)).toEqual([
            200_000, 400_000, 600_000,
        ]);
    });

    it('still deals damage when the focus HP field is left at its 0 default', () => {
        // `hp` defaults to 0 in `simulateDPS` and on the page. A focus at currentHp 0 has NEVER
        // BEEN ALIVE — it is not a corpse — so it must still take its turn.
        const { rounds } = simulateDPS(baseInput({ shipSkills: damageKit(), rounds: 3 }));
        expect(rounds.every((r) => r.directDamage > 0)).toBe(true);
    });
});

describe('#415 the healing report stays out of a DPS result', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('omits the healing block in dps mode', () => {
        const result = runCombat({ ...bareInput(), mode: 'dps' });
        expect('healing' in result).toBe(false);
    });

    it('keeps the healing block in battle mode', () => {
        const result = runCombat({ ...bareInput(), mode: 'battle', enemyAttackers: bareEnemy() });
        expect('healing' in result).toBe(true);
    });

    it('keeps the healing block in healing mode', () => {
        const result = runCombat({
            ...bareInput(),
            mode: 'healing',
            healTargetId: 'attacker',
            enemyAttackers: bareEnemy(),
        });
        expect('healing' in result).toBe(true);
    });

    it('still refuses an explicit healTargetId in dps mode', () => {
        expect(() => runCombat({ ...bareInput(), mode: 'dps', healTargetId: 'attacker' })).toThrow(
            /healTargetId requires mode/
        );
    });
});
