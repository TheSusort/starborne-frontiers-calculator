import { AbilityType } from '../../types/abilities';

/**
 * Ability types not yet consumed by any calculator. They stay pickable in the
 * editor (annotations for the healing-calc / combat-sim phases) but are visibly
 * marked so a configured ability isn't mistaken for a simulated one.
 * heal / shield / cleanse are intentionally NOT in this set — the healing
 * calculator consumes them (adopted in the healing-calc engine work).
 * purge keeps its count field editable for annotation while still flagged here.
 * `control` stays flagged because its OWN lockout/combat effect (Stasis/Taunt/
 * etc.) is still unsimulated — but it is now a TRIGGER SOURCE: the cast-path
 * emits a `control-applied` event that drives reactions (e.g. Defiant's
 * shield-on-Stasis). So the control's effect is unsimulated even though it can
 * fire a simulated reaction.
 */
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set(['purge', 'control']);

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
