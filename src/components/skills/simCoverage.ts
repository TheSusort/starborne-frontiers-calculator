import { Ability, AbilityType, ControlEffect } from '../../types/abilities';

/**
 * Ability types not yet consumed by any calculator. They stay pickable in the
 * editor (annotations for the healing-calc / combat-sim phases) but are visibly
 * marked so a configured ability isn't mistaken for a simulated one.
 * heal / shield / cleanse / purge are intentionally NOT in this set — the
 * healing calculator / combat sim consume them (heal/shield/cleanse in the
 * healing-calc work; purge in the C2a on-cast purge work, which removes enemy
 * buffs from the cast path).
 * `control` is NOT in this set: control simulation is now effect-aware (see
 * SIMULATED_CONTROL_EFFECTS + isAbilityNotSimulated). The five named effects
 * (stasis / provoke / taunt / concentrate-fire / disable) are simulated via the
 * named-status path and emit `control-applied` events. Only Overload remains
 * unmodeled and still shows the "Not simulated" badge.
 */
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set([]);

/**
 * The five control effects that are fully modeled in the combat engine.
 * Overload is excluded — it is deferred to a future project.
 */
export const SIMULATED_CONTROL_EFFECTS: ReadonlySet<ControlEffect> = new Set([
    'stasis',
    'provoke',
    'taunt',
    'concentrate-fire',
    'disable',
]);

/**
 * Returns true when an ability should show the "Not simulated" badge.
 *
 * For `type:'control'` abilities the decision is per-effect:
 *   - A modeled effect (stasis / provoke / taunt / concentrate-fire / disable)
 *     returns false (IS simulated).
 *   - An unmodeled effect (currently: overload) returns true (NOT simulated).
 *
 * All other ability types fall back to the NOT_SIMULATED_TYPES set (currently
 * empty — all other ability types are simulated).
 */
export function isAbilityNotSimulated(ability: Ability): boolean {
    if (ability.type === 'control' && ability.config.type === 'control') {
        return !SIMULATED_CONTROL_EFFECTS.has(ability.config.effect);
    }
    return NOT_SIMULATED_TYPES.has(ability.type);
}

/**
 * Ability types the DPS sim sources from the FIRING skill only (active/charged).
 * Placed on the passive slot they are silent no-ops today — warn, don't block,
 * so real ship passives can still be documented ahead of sim support.
 * `charge` is NOT in this set: passive charge auras are sourced into the charge
 * cadence on active rounds (see src/utils/combat/engine.ts).
 * See docs/skill-model-coverage.md section 4 (slot sourcing).
 */
export const PASSIVE_NOOP_TYPES: ReadonlySet<AbilityType> = new Set([
    'dot',
    'detonate-dot',
    'accumulate-detonate',
    'additional-damage',
]);

export const NOT_SIMULATED_NOTE = 'Not simulated in the calculators yet.';
export const PASSIVE_NOOP_WARNING =
    'Not simulated on the passive slot — the DPS calculator only reads this ability type from the active and charged skills.';
