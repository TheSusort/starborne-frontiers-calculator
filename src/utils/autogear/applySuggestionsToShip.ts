import type { Ship } from '../../types/ship';
import type { GearSuggestion } from '../../types/autogear';

const isImplantSlot = (slotName: string): boolean => slotName.startsWith('implant_');

/**
 * The ship wearing a suggestion list: each suggestion overwrites its slot (implant slots into
 * `implants`, every other slot into `equipment`). Slots the suggestions do not name keep the
 * ship's current piece.
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
