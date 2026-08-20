import { Ability, AbilityTrigger, AbilityType, ControlEffect } from '../../types/abilities';

/**
 * Ability types not yet consumed by any calculator. They stay pickable in the
 * editor (annotations for the healing-calc / combat-sim phases) but are visibly
 * marked so a configured ability isn't mistaken for a simulated one.
 * heal / shield / cleanse / purge are intentionally NOT in this set — the
 * healing calculator / combat sim consume them (heal/shield/cleanse in the
 * healing-calc work; purge in the C2a on-cast purge work, which removes enemy
 * buffs from the cast path).
 * `control` is NOT in this set: control simulation is now effect-aware (see
 * SIMULATED_CONTROL_EFFECTS + isAbilityNotSimulated). Every named effect
 * (stasis / provoke / taunt / concentrate-fire / disable) is simulated via the
 * named-status path and emits `control-applied` events. With Overload's
 * lifecycle now modeled, no control effect remains unmodeled and the
 * "Not simulated" badge no longer fires for any ability type or effect.
 */
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set([]);

/**
 * Every control effect — all are fully modeled in the combat engine. Overload
 * was the last holdout; its lose-on-kill lifecycle is now simulated, so the set
 * mirrors the full ControlEffect enum.
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
 * For `type:'control'` abilities the decision is per-effect, but every control
 * effect (stasis / provoke / taunt / concentrate-fire / disable) is now modeled,
 * so this returns false for all of them.
 *
 * All other ability types fall back to the NOT_SIMULATED_TYPES set (currently
 * empty — all other ability types are simulated). The badge machinery stays for
 * future unmodeled mechanics but nothing triggers it today.
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
 * See docs/skill-model-coverage.archived-2026-06-12.md section 4 (slot sourcing).
 */
export const PASSIVE_NOOP_TYPES: ReadonlySet<AbilityType> = new Set([
    'dot',
    'detonate-dot',
    'accumulate-detonate',
    'additional-damage',
    'shield-strip',
    // PR10: buff-steal is read only from the FIRING skill's abilities (gatedSkill in
    // playerTurn.ts — active/charged), mirroring the on-cast purge loop it's modeled after.
    // A hand-configured passive-slot buff-steal never reaches that loop.
    'buff-steal',
]);

export const NOT_SIMULATED_NOTE = 'Not simulated in the calculators yet.';
export const PASSIVE_NOOP_WARNING =
    'Not simulated on the passive slot — the DPS calculator only reads this ability type from the active and charged skills.';

/**
 * Triggers that fire on the clock rather than on something an enemy did, so nothing in the event
 * says WHICH enemy — read off the listener bodies in `src/utils/combat/triggers.ts`, where all four
 * are a bare `enqueue(intent)` with no event context at all.
 *
 * `on-deal-damage` is deliberately ABSENT: it looks like it belongs here (it is not one of the
 * "on that enemy" counter triggers) but its listener does name the enemy the owner just hit, so an
 * infliction on it lands normally.
 */
const VICTIMLESS_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
    'start-of-round',
    'end-of-round',
    'start-of-turn',
    'end-of-turn',
]);

/**
 * Ability types the reactive executor DROPS when the trigger names no enemy (SP-4c-2d). Measured,
 * not assumed:
 *  - `dot` / `debuff` drop. Their target barely matters — see the carve-out below for the single
 *    exception, and note that the fan-out targets (`all-enemies`, `adjacent-enemies`) do NOT rescue
 *    the shape: the dot branch only fans out over ids the triggering event carries, and the debuff
 *    branch's fan-out anchors on the event's victim, which a victimless trigger never supplies.
 *  - `damage` is EXCLUDED because it picks the first living opposing ship for itself (Judge /
 *    Incinerator's start-of-round procs fire normally).
 *  - `purge` also drops unless it targets the most-buffed enemy, but the editor only offers the
 *    Trigger dropdown for buff/debuff/dot/charge/heal/shield/cleanse/damage, so a hand-authored
 *    purge can never leave `on-cast` and cannot reach this shape.
 */
const INFLICTION_TYPES: ReadonlySet<AbilityType> = new Set(['dot', 'debuff']);

/**
 * THE ONE COMBINATION THAT WORKS, and it is a shipped ship: Selenite's refit passive is
 * `debuff` + `start-of-round` + `enemy-highest-attack` ("at the start of the round, the highest
 * attack enemy is applied with Concentrate Fire"). The debuff executor resolves that target through
 * its own highest-attack selector instead of from the triggering event, so nothing is dropped.
 *
 * DEBUFF-ONLY on purpose: the `dot` executor has no such selector, so the same target does not
 * rescue a dot. Confirmed by measurement, not by symmetry.
 */
const isSelfResolvingSelector = (ability: Ability): boolean =>
    ability.type === 'debuff' && ability.target === 'enemy-highest-attack';

export const VICTIMLESS_INFLICTION_WARNING =
    'Nothing will be applied in the combat simulator: this trigger does not single out an enemy ' +
    'ship, so the effect has no one to land on. Pick a trigger that names an enemy — for example ' +
    '"When attacked" or "On dealing direct damage" — or move this effect to the skill the ship casts.';

/**
 * True when the combat engine would silently drop this ability: a DoT or debuff on a trigger that
 * names no enemy. The editor WARNS rather than blocks — there is no target the user could pick that
 * would make the shape work, so removing options would leave them nowhere to go, and the same
 * "warn, don't block" rule already governs PASSIVE_NOOP_TYPES above.
 */
export function isVictimlessInfliction(ability: Ability): boolean {
    if (!INFLICTION_TYPES.has(ability.type)) return false;
    if (!VICTIMLESS_TRIGGERS.has(ability.trigger)) return false;
    return !isSelfResolvingSelector(ability);
}
