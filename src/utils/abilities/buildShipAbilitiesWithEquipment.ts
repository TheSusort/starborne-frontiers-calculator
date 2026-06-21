/**
 * buildShipAbilitiesWithEquipment
 *
 * Thin wrapper around `buildShipAbilities` that merges equipment-derived abilities
 * (gear-set bonuses + implant effects) into the passive skill slot.
 *
 * `buildShipAbilities` is left single-arg / untouched (Task 3 invariant).
 * When `buildEquipmentAbilities` returns an empty list (no active gear sets, no
 * ability-bearing implants, or a ship with no equipment at all) the result is
 * byte-identical to calling `buildShipAbilities` directly — existing goldens are
 * unaffected.
 */

import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { ShipSkills } from '../../types/abilities';
import { buildShipAbilities } from './buildShipAbilities';
import { buildEquipmentAbilities } from './buildEquipmentAbilities';

/**
 * Build the full ability roster for a ship, including equipment-sourced abilities.
 *
 * @param ship          The ship to resolve abilities for.
 * @param getGearPiece  Inventory lookup — maps a gear id to a GearPiece (or undefined).
 * @returns             A ShipSkills object with equipment abilities appended to the passive slot.
 */
// Returns the same ShipSkills reference in both paths; in-place mutation is safe because buildShipAbilities allocates a fresh object per call.
export function buildShipAbilitiesWithEquipment(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined
): ShipSkills {
    const skills = buildShipAbilities(ship);
    const equip = buildEquipmentAbilities(ship, getGearPiece);
    if (!equip.length) return skills;
    const passive = skills.slots.find((s) => s.slot === 'passive');
    if (passive) {
        passive.abilities.push(...equip);
    } else {
        skills.slots.push({ slot: 'passive', abilities: equip });
    }
    return skills;
}
