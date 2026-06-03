import { AbilityType } from '../../types/abilities';

/**
 * Ability types the DPS sim does not consume at all. They stay pickable in the
 * editor (annotations for the future Healing-calc / combat-sim phases) but must
 * be visibly marked so a configured ability isn't mistaken for a simulated one.
 */
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set([
    'heal',
    'shield',
    'cleanse',
    'purge',
    'control',
]);

/**
 * Ability types the DPS sim sources from the FIRING skill only (active/charged).
 * Placed on the passive slot they are silent no-ops today — warn, don't block,
 * so real ship passives can still be documented ahead of sim support.
 * See docs/skill-model-coverage.md section 4 (slot sourcing).
 */
export const PASSIVE_NOOP_TYPES: ReadonlySet<AbilityType> = new Set([
    'dot',
    'charge',
    'detonate-dot',
    'accumulate-detonate',
    'additional-damage',
]);

export const NOT_SIMULATED_NOTE = 'Not simulated in the DPS calculator yet.';
export const PASSIVE_NOOP_WARNING =
    'Not simulated on the passive slot - the DPS calculator only reads this ability type from the active and charged skills.';
