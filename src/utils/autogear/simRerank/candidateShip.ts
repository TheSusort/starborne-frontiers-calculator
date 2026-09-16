import type { Ship } from '../../../types/ship';
import type { GearSuggestion } from '../../../types/autogear';

const isImplantSlot = (slotName: string): boolean => slotName.startsWith('implant_');

/**
 * A ship wearing a candidate loadout.
 *
 * Returns a `Ship`, not a stat block: `simulateBattle` derives gear-set abilities from
 * `ship.equipment` through `buildShipAbilitiesWithEquipment`, so a baked block drops every gear
 * ability while still producing plausible numbers.
 *
 * Slots the suggestions do not name keep the ship's current piece — a partial loadout is a real
 * autogear result, not an error.
 */
export function applySuggestionsToShip(ship: Ship, suggestions: GearSuggestion[]): Ship {
    const equipment = { ...ship.equipment };
    const implants = { ...ship.implants };

    for (const suggestion of suggestions) {
        if (isImplantSlot(suggestion.slotName)) {
            implants[suggestion.slotName] = suggestion.gearId;
        } else {
            equipment[suggestion.slotName] = suggestion.gearId;
        }
    }

    return { ...ship, equipment, implants };
}
