import type { Ability, ShipSkills, SkillSlot } from '../../types/abilities';

/**
 * Viral gear set support. Scans a ship's PASSIVE abilities for `dot-duration-extension` configs
 * (emitted by GEAR_SET_ABILITIES.VIRAL) and returns the max extra turns (0 if none).
 * Pure; never throws.
 */
export function dotDurationExtensionTurns(skills: ShipSkills | undefined): number {
    if (!skills?.slots) return 0;
    let max = 0;
    for (const slot of skills.slots) {
        if (slot.slot !== 'passive') continue;
        for (const ability of slot.abilities) {
            if (ability.config.type === 'dot-duration-extension') {
                max = Math.max(max, ability.config.turns);
            }
        }
    }
    return max;
}

/**
 * Build a per-owner DoT extension map from a list of actors. Owners with no extension are
 * ABSENT (callers default a miss to 0). Backs the StatusEngineInput.dotDurationExtensionFor
 * lookup.
 */
export function buildDotDurationExtensionByOwner(
    actors: Array<{ id: string; shipSkills: ShipSkills | undefined }>
): Map<string, number> {
    const map = new Map<string, number>();
    for (const { id, shipSkills } of actors) {
        const turns = dotDurationExtensionTurns(shipSkills);
        if (turns > 0) map.set(id, turns);
    }
    return map;
}

/**
 * Whether a reactive DoT counts as applied FROM the active or charged skill, the only DoTs Viral
 * extends: a triggered clause written in that skill's text. Gear-set and implant DoTs are merged
 * into the passive slot and stamped `source: 'equipment'`; the source check keeps them out even
 * if one ever rides another slot.
 */
export function extendsDotFrom(sourceSlot: SkillSlot, ability: Ability): boolean {
    return (sourceSlot === 'active' || sourceSlot === 'charged') && ability.source !== 'equipment';
}

/**
 * Whether a Viral set would extend anything this kit applies: an active- or charged-slot DoT
 * that is not a bomb (`applyNewDoTs` never extends a bomb's countdown) and passes
 * `extendsDotFrom`. Autogear gates the Viral score bonus on this.
 */
export function skillsApplyExtendableDoT(skills: ShipSkills | undefined): boolean {
    if (!skills?.slots) return false;
    return skills.slots.some((skill) =>
        skill.abilities.some(
            (ability) =>
                ability.config.type === 'dot' &&
                ability.config.dotType !== 'bomb' &&
                extendsDotFrom(skill.slot, ability)
        )
    );
}
