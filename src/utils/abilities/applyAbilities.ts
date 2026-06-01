import { Ability, ShipSkills, Skill } from '../../types/abilities';
import { DoTApplicationConfig, SecondaryDamage } from '../../types/calculator';

/** The skill in the slot matching the round's action, or undefined if absent. */
export function selectFiringSkill(
    shipSkills: ShipSkills,
    action: 'active' | 'charged'
): Skill | undefined {
    return shipSkills.slots.find((s) => s.slot === action);
}

/**
 * Damage inputs for a firing skill: the first `damage` ability's multiplier and
 * hit count (default 1), plus the ability itself for conditional scaling. When
 * there is no damage ability, contributes nothing (multiplier 0, hits 1).
 */
export function damageInputsFromSkill(skill: Skill | undefined): {
    multiplier: number;
    hits: number;
    scalingAbility?: Ability;
} {
    const damage = skill?.abilities.find((a) => a.type === 'damage');
    if (!damage || damage.config.type !== 'damage') {
        return { multiplier: 0, hits: 1, scalingAbility: undefined };
    }
    return {
        multiplier: damage.config.multiplier,
        hits: damage.config.hits ?? 1,
        scalingAbility: damage,
    };
}

/** First `additional-damage` ability mapped to a SecondaryDamage, or undefined. */
export function secondaryFromSkill(skill: Skill | undefined): SecondaryDamage | undefined {
    const additional = skill?.abilities.find((a) => a.type === 'additional-damage');
    if (!additional || additional.config.type !== 'additional-damage') return undefined;
    return { stat: additional.config.stat, pct: additional.config.pct };
}

/** All `dot` abilities mapped to DoT application entries. */
export function dotsFromSkill(skill: Skill | undefined): DoTApplicationConfig {
    if (!skill) return [];
    const config: DoTApplicationConfig = [];
    for (const ability of skill.abilities) {
        if (ability.type !== 'dot' || ability.config.type !== 'dot') continue;
        config.push({
            id: ability.id,
            type: ability.config.dotType,
            tier: ability.config.tier,
            stacks: ability.config.stacks,
            duration: ability.config.duration,
        });
    }
    return config;
}

/** All `charge` abilities on the skill. */
export function chargeAbilitiesFromSkill(skill: Skill | undefined): Ability[] {
    return skill?.abilities.filter((a) => a.type === 'charge') ?? [];
}
