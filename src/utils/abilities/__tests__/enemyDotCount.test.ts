import { describe, it, expect } from 'vitest';
import { conditionMet, evaluateCondition } from '../evaluateConditions';
import { buildShipAbilities } from '../buildShipAbilities';
import { Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { makeConditionContext } from './conditionContextFixture';

// Local copy of the modelCompletenessTriage.test.ts `abilitiesFor` helper (not imported —
// importing a sibling *.test.ts file would re-register its describe/it blocks here too).
function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}
function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}
function abilitiesFor(over: Partial<Ship>, name: string) {
    return slot(buildShipAbilities(ship(over)).slots, name)?.abilities ?? [];
}

// Model-completeness SP-D — `enemy-dot-count` (Anemone's generic "3+ Damage over Time effects"
// Taunt gate, Belladonna's named "3+ Acidic Decay" Stasis gate, Snakeroot's per-stack scaling).
describe('enemy-dot-count condition', () => {
    it('bare enemy-dot-count = sum of DoT entries (Anemone), gate gte 3', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 3 }))).toBe(true);
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 2 }))).toBe(false);
    });

    it('named family filter is 0 until the family exists (Belladonna Acidic Decay inert)', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            buffName: 'Acidic Decay',
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 5 }))).toBe(false); // no Acidic Decay family yet
    });

    it('as a scaling source, returns the raw DoT entry count (Snakeroot)', () => {
        const cond = { subject: 'enemy-dot-count' as const, derivable: true };
        expect(evaluateCondition(cond, makeConditionContext({ enemyDotCount: 8 }))).toBe(8);
    });

    it('named family filter reads enemyDotFamilyCounts when populated (post-SP-E)', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            buffName: 'Acidic Decay',
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(
            conditionMet(
                cond,
                makeConditionContext({
                    enemyDotCount: 5,
                    enemyDotFamilyCounts: { 'Acidic Decay': 3 },
                })
            )
        ).toBe(true);
    });
});

describe('enemy-dot-count parsing (countGateCondition DoT branch)', () => {
    // Verbatim from docs/ship-skills.csv (charge_skill_text field) — same constant used by the
    // SP-D Anemone triage probe.
    const ANEMONE_CHARGE =
        'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns. If the primary enemy has 3 or more Damage over Time effects, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

    it('Anemone charged: Taunt gated on generic DoT count >=3 (drops the spurious self-buff Taunt artifact)', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: ANEMONE_CHARGE, chargeSkillCharge: 3 },
            'charged'
        );
        const taunt = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'taunt'
        );
        expect(
            taunt?.conditions.some(
                (c) => c.subject === 'enemy-dot-count' && c.countThreshold === 3 && !c.buffName
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (charge_skill_text field) — same constant used by the
    // SP-D Belladonna triage probe.
    const BELLADONNA_CHARGE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.<br />If the enemy has 3 or more <unit-skill>Acidic Decay</unit-skill>, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';

    it('Belladonna charged: Stasis gated on Acidic Decay count >=3', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: BELLADONNA_CHARGE, chargeSkillCharge: 3 },
            'charged'
        );
        const bellaStasis = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(
            bellaStasis?.conditions.some(
                (c) =>
                    c.subject === 'enemy-dot-count' &&
                    c.buffName === 'Acidic Decay' &&
                    c.countThreshold === 3
            )
        ).toBe(true);
    });
});
