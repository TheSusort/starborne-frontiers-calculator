import { Ability, ShipSkills, Skill } from '../../types/abilities';
import { DoTApplicationConfig, SecondaryDamage } from '../../types/calculator';
import { ConditionContext, conditionsMet, scaledBonus } from './evaluateConditions';

/** Folded passive-modifier deltas, in the same units as the DPS buff totals (percentage points). */
export interface ModifierTotals {
    attack: number;
    crit: number;
    critDamage: number;
    outgoingDamage: number;
    defence: number;
    defensePenetration: number;
    hp: number;
}

/**
 * Sum the values of all active `modifier` abilities into stat buckets. A modifier is
 * "active" when its conditions are met for the given context. Channels map to buckets
 * 1:1 except `defense` → `defence` (spelling). `outgoingHeal` and `incomingDamage`
 * have no DPS bucket and are ignored. Returns all-zero totals when nothing applies.
 */
export function modifierTotalsFromAbilities(
    abilities: Ability[],
    ctx: ConditionContext
): ModifierTotals {
    const totals: ModifierTotals = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        outgoingDamage: 0,
        defence: 0,
        defensePenetration: 0,
        hp: 0,
    };
    for (const ability of abilities) {
        if (ability.type !== 'modifier' || ability.config.type !== 'modifier') continue;
        if (!conditionsMet(ability.conditions, ctx)) continue;
        // `isMultiplicative` is intentionally ignored: these deltas are summed into the
        // same additive-percentage buff totals as the buff path (calculateBuffTotals).
        // Revisit if a flat or true-multiplicative modifier is ever introduced.
        // Additive: flat config value + per-condition scaled bonus (capped). A pure
        // scaling modifier (e.g. "7.5% defPen per buff, up to 45%") has value 0 and a
        // scaling rule; a flat modifier has no scaling.
        const { channel } = ability.config;
        const amount = ability.config.value + (ability.scaling ? scaledBonus(ability, ctx) : 0);
        switch (channel) {
            case 'attack':
                totals.attack += amount;
                break;
            case 'crit':
                totals.crit += amount;
                break;
            case 'critDamage':
                totals.critDamage += amount;
                break;
            case 'outgoingDamage':
                totals.outgoingDamage += amount;
                break;
            case 'defense':
                totals.defence += amount;
                break;
            case 'defensePenetration':
                totals.defensePenetration += amount;
                break;
            case 'hp':
                totals.hp += amount;
                break;
            // 'outgoingHeal' | 'incomingDamage' have no DPS bucket — ignore.
        }
    }
    return totals;
}

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
    noCrit: boolean;
} {
    const damage = skill?.abilities.find((a) => a.type === 'damage');
    if (!damage || damage.config.type !== 'damage') {
        return { multiplier: 0, hits: 1, scalingAbility: undefined, noCrit: false };
    }
    return {
        multiplier: damage.config.multiplier,
        hits: damage.config.hits ?? 1,
        scalingAbility: damage,
        noCrit: damage.config.noCrit ?? false,
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

/** Total turns this skill extends active DoTs by (sum of all `extend-dot` abilities). */
export function extendDotTurnsFromSkill(skill: Skill | undefined): number {
    if (!skill) return 0;
    let turns = 0;
    for (const ability of skill.abilities) {
        if (ability.config.type === 'extend-dot') turns += ability.config.turns;
    }
    return turns;
}

/** `detonate-dot` abilities on the skill, as {dotType, powerPct} pairs. */
export function detonationsFromSkill(
    skill: Skill | undefined
): { dotType: 'corrosion' | 'inferno' | 'bomb'; powerPct: number }[] {
    if (!skill) return [];
    const out: { dotType: 'corrosion' | 'inferno' | 'bomb'; powerPct: number }[] = [];
    for (const ability of skill.abilities) {
        if (ability.config.type === 'detonate-dot') {
            out.push({ dotType: ability.config.dotType, powerPct: ability.config.powerPct });
        }
    }
    return out;
}
