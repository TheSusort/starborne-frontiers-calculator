import {
    ConditionalCondition,
    DoTApplicationEntry,
    EnemyBaseClass,
    SecondaryDamage,
    ConditionalDamage,
} from '../../types/calculator';
import { Ability, Condition, ShipSkills, Skill } from '../../types/abilities';
import type { DPSSimulationInput } from '../calculators/dpsSimulator';

/**
 * Adapter-local condition mapper. Unlike buildShipAbilities's 5-arg version, this
 * does NOT inspect raw text or tag a buffName — the flat DPS input carries no skill
 * text, and tagging buffName:'Stealth' on a self-buff conditional would change the
 * numeric result (Task 2's numeric-identity proof depends on derivable passing
 * through verbatim and no extra condition fields being invented).
 */
function toCondition(
    condition: ConditionalCondition,
    derivable: boolean,
    manualCount: number | undefined,
    requiredEnemyType: EnemyBaseClass | undefined
): Condition {
    return {
        // ConditionalCondition is a subset of ConditionSubject.
        subject: condition,
        derivable,
        ...(manualCount !== undefined ? { manualCount } : {}),
        ...(requiredEnemyType ? { requiredEnemyType } : {}),
    };
}

function damageAbility(id: string, multiplier: number): Ability {
    return {
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier },
        autoFilled: true,
    };
}

function additionalDamageAbility(id: string, secondary: SecondaryDamage): Ability {
    return {
        id,
        type: 'additional-damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'additional-damage', stat: secondary.stat, pct: secondary.pct },
        autoFilled: true,
    };
}

function dotAbility(id: string, entry: DoTApplicationEntry): Ability {
    return {
        id,
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'dot',
            dotType: entry.type,
            tier: entry.tier,
            stacks: entry.stacks,
            duration: entry.duration,
        },
        autoFilled: true,
    };
}

/** Attaches conditional scaling to the (damage) ability at the head of the list. */
function applyConditional(damage: Ability, conditional: ConditionalDamage): void {
    damage.conditions = [
        toCondition(
            conditional.condition,
            conditional.derivable,
            conditional.manualCount,
            undefined
        ),
    ];
    damage.scaling = {
        conditionIndex: 0,
        perUnit: conditional.pct,
        ...(conditional.cap !== undefined ? { cap: conditional.cap } : {}),
    };
}

/**
 * Converts the flat per-skill damage fields of a DPSSimulationInput into a
 * ShipSkills model. Only damage-shaped fields are converted — buffs, debuffs,
 * stats, and ally charge gain stay on the flat input and are not represented here.
 */
export function flatInputToAbilities(input: DPSSimulationInput): ShipSkills {
    const slots: Skill[] = [];

    // The flat damage fields are optional on the input type (callers that pass a
    // shipSkills model omit them); default them to their prior implicit values.
    const activeMultiplier = input.activeMultiplier ?? 0;
    const chargedMultiplier = input.chargedMultiplier ?? 0;
    const activeDoTs = input.activeDoTs ?? [];
    const chargedDoTs = input.chargedDoTs ?? [];

    // --- Active skill (always present) ---
    const activeAbilities: Ability[] = [];
    const activeDamage = damageAbility('adapter-active-damage', activeMultiplier);
    activeAbilities.push(activeDamage);

    if (input.activeSecondary) {
        activeAbilities.push(
            additionalDamageAbility('adapter-active-additional', input.activeSecondary)
        );
    }

    activeDoTs.forEach((entry, i) => {
        activeAbilities.push(dotAbility(`adapter-active-dot-${i}`, entry));
    });

    if (input.selfChargeGain) {
        activeAbilities.push({
            id: 'adapter-active-charge',
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            conditions: [
                toCondition(
                    input.selfChargeGain.condition,
                    input.selfChargeGain.derivable,
                    input.selfChargeGain.manualCount,
                    input.selfChargeGain.requiredEnemyType
                ),
            ],
            config: { type: 'charge', amount: input.selfChargeGain.amount },
            autoFilled: true,
        });
    }

    if (input.activeConditional) {
        applyConditional(activeDamage, input.activeConditional);
    }

    slots.push({ slot: 'active', abilities: activeAbilities });

    // --- Charged skill (only when present) ---
    if (chargedMultiplier > 0) {
        const chargedAbilities: Ability[] = [];
        const chargedDamage = damageAbility('adapter-charged-damage', chargedMultiplier);
        chargedAbilities.push(chargedDamage);

        if (input.chargedSecondary) {
            chargedAbilities.push(
                additionalDamageAbility('adapter-charged-additional', input.chargedSecondary)
            );
        }

        chargedDoTs.forEach((entry, i) => {
            chargedAbilities.push(dotAbility(`adapter-charged-dot-${i}`, entry));
        });

        if (input.chargedConditional) {
            applyConditional(chargedDamage, input.chargedConditional);
        }

        slots.push({ slot: 'charged', abilities: chargedAbilities });
    }

    return { slots };
}
