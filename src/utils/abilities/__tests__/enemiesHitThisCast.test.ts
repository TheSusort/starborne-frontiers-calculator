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

describe('enemies-hit-this-cast condition', () => {
    it('gte 3 met only when 3+ enemies hit', () => {
        const cond = {
            subject: 'enemies-hit-this-cast' as const,
            derivable: true,
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(conditionMet(cond, makeConditionContext({ enemiesHitThisCast: 3 }))).toBe(true);
        expect(conditionMet(cond, makeConditionContext({ enemiesHitThisCast: 2 }))).toBe(false);
    });

    it('defaults to 1 (single-target DPS) → gte 2 not met', () => {
        const cond = {
            subject: 'enemies-hit-this-cast' as const,
            derivable: true,
            countComparator: 'gte' as const,
            countThreshold: 2,
        };
        expect(conditionMet(cond, makeConditionContext({}))).toBe(false);
    });
});

describe('enemies-hit-this-cast — parser output (buildShipAbilities)', () => {
    // Verbatim from docs/ship-skills.csv (second_passive_skill_text field). NOTE: CSV typo
    // "3 ore more" preserved verbatim (not "or more").
    const BERSERKER_P2 =
        'This Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns when hitting 3 ore more enemies.';

    it('Berserker passive2: Marauder Rage II buff gated on >=3 hits', () => {
        const abilities = abilitiesFor({ secondPassiveSkillText: BERSERKER_P2 }, 'passive');
        const rageBuff = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Marauder Rage II'
        );
        expect(
            rageBuff?.conditions.some(
                (c) =>
                    c.subject === 'enemies-hit-this-cast' &&
                    c.countComparator === 'gte' &&
                    c.countThreshold === 3
            )
        ).toBe(true);
    });

    // Verbatim from docs/ship-skills.csv (active_skill_text field).
    const TYGR_ACTIVE =
        'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down II</unit-skill> for 2 turns. If it damages <unit-aid>2 or more enemies, it adds 1 charge</unit-aid> to its Charged Skill.';

    it('Tygr active: self-charge-gain gated on >=2 hits (NOT enemy-adjacent)', () => {
        const abilities = abilitiesFor({ activeSkillText: TYGR_ACTIVE }, 'active');
        const chargeGain = abilities.find((a) => a.config.type === 'charge');
        const tygrChargeCond = chargeGain?.conditions.find((c) => c.subject !== 'always');
        expect(tygrChargeCond?.subject).toBe('enemies-hit-this-cast');
        expect(tygrChargeCond?.countThreshold).toBe(2);
    });
});
