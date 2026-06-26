import type { ShipSkills } from '../../types/abilities';

/**
 * Boost gear set support. Scans a ship's PASSIVE abilities for `buff-duration-extension`
 * configs (emitted by GEAR_SET_ABILITIES.BOOST) and returns the max extra turns (0 if none).
 * Pure; never throws.
 */
export function buffDurationExtensionTurns(skills: ShipSkills | undefined): number {
    if (!skills?.slots) return 0;
    let max = 0;
    for (const slot of skills.slots) {
        if (slot.slot !== 'passive') continue;
        for (const ability of slot.abilities) {
            if (ability.config.type === 'buff-duration-extension') {
                max = Math.max(max, ability.config.turns);
            }
        }
    }
    return max;
}

/**
 * Build a per-owner extension map from a list of actors. Owners with no extension are
 * ABSENT (callers default a miss to 0). Used by the engine to back the
 * StatusEngineInput.buffDurationExtensionFor lookup.
 */
export function buildBuffDurationExtensionByOwner(
    actors: Array<{ id: string; shipSkills: ShipSkills | undefined }>
): Map<string, number> {
    const map = new Map<string, number>();
    for (const { id, shipSkills } of actors) {
        const turns = buffDurationExtensionTurns(shipSkills);
        if (turns > 0) map.set(id, turns);
    }
    return map;
}
