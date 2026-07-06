import { describe, it, expect } from 'vitest';
import { conditionMet } from '../evaluateConditions';
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

describe('stat-vs-target condition', () => {
    it('crit-power gt: met when self crit power exceeds target', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'crit-power' as const,
            statComparator: 'gt' as const,
        };
        expect(
            conditionMet(cond, makeConditionContext({ selfCritPower: 150, targetCritPower: 100 }))
        ).toBe(true);
        expect(
            conditionMet(cond, makeConditionContext({ selfCritPower: 100, targetCritPower: 150 }))
        ).toBe(false);
    });
    it('speed lt: met when self speed is below target (Chakara)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'speed' as const,
            statComparator: 'lt' as const,
        };
        expect(conditionMet(cond, makeConditionContext({ selfSpeed: 40, targetSpeed: 60 }))).toBe(
            true
        );
        expect(conditionMet(cond, makeConditionContext({ selfSpeed: 60, targetSpeed: 40 }))).toBe(
            false
        );
    });
    it('hp gt: uses ABSOLUTE current HP, not percentage (Cobalt)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'hp' as const,
            statComparator: 'gt' as const,
        };
        expect(
            conditionMet(
                cond,
                makeConditionContext({ selfCurrentHp: 50000, targetCurrentHp: 18000 })
            )
        ).toBe(true);
        expect(
            conditionMet(
                cond,
                makeConditionContext({ selfCurrentHp: 10000, targetCurrentHp: 18000 })
            )
        ).toBe(false);
    });
    it('unset target stat defaults to 0 (crit power: no enemy field → gate met)', () => {
        const cond = {
            subject: 'stat-vs-target' as const,
            derivable: true,
            compareStat: 'crit-power' as const,
            statComparator: 'gt' as const,
        };
        expect(conditionMet(cond, makeConditionContext({ selfCritPower: 150 }))).toBe(true);
    });
});

describe('parser via buildShipAbilities', () => {
    // Verbatim from docs/ship-skills.csv (charge_skill_text field) — same constant used by the
    // SP-C Bayah triage probe in modelCompletenessTriage.test.ts.
    const BAYAH_CHARGE =
        'This Unit deals <unit-damage>150% damage</unit-damage> plus an additional amount equal to <unit-damage>30%</unit-damage> of its Defense and inflicts <unit-skill>Crit Rate Down II</unit-skill> for 2 turns. If this Unit has more Crit Power than the target, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';

    it('Bayah charged: Stasis inflict gated on crit-power gt', () => {
        const abilities = abilitiesFor(
            { chargeSkillText: BAYAH_CHARGE, chargeSkillCharge: 2 },
            'charged'
        );
        const stasis = abilities.find(
            (a) => a.config.type === 'control' && a.config.effect === 'stasis'
        );
        expect(
            stasis?.conditions.some(
                (c) =>
                    c.subject === 'stat-vs-target' &&
                    c.compareStat === 'crit-power' &&
                    c.statComparator === 'gt'
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field) — same constant used by the
    // SP-C Cobalt triage probe.
    const COBALT_ACTIVE =
        "This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>. If this Unit has more HP than the enemy, it additionally deals <unit-damage>damage equal to 25%</unit-damage> of this Unit's max HP.";

    it('Cobalt active: 25%-max-HP additional-damage gated on hp gt', () => {
        const abilities = abilitiesFor({ activeSkillText: COBALT_ACTIVE }, 'active');
        const bonusDamage = abilities.find(
            (a) =>
                a.config.type === 'additional-damage' &&
                a.config.stat === 'hp' &&
                a.config.pct === 25
        );
        expect(
            bonusDamage?.conditions.some(
                (c) =>
                    c.subject === 'stat-vs-target' &&
                    c.compareStat === 'hp' &&
                    c.statComparator === 'gt'
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field) — same constant used by the
    // SP-C Chakara triage probe.
    const CHAKARA_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

    it('Chakara active: self-charge-gain gated on speed lt', () => {
        const abilities = abilitiesFor({ activeSkillText: CHAKARA_ACTIVE }, 'active');
        const chargeGain = abilities.find((a) => a.config.type === 'charge');
        expect(
            chargeGain?.conditions.some(
                (c) =>
                    c.subject === 'stat-vs-target' &&
                    c.compareStat === 'speed' &&
                    c.statComparator === 'lt'
            )
        ).toBe(true);
    });
});
