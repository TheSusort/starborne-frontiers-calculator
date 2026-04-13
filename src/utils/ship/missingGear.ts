import { Ship } from '../../types/ship';
import { GEAR_SLOTS, IMPLANT_SLOTS } from '../../constants/gearTypes';

const ALL_GEAR_SLOT_KEYS = Object.keys(GEAR_SLOTS);
const ALL_IMPLANT_SLOT_KEYS = Object.keys(IMPLANT_SLOTS);

export const getEmptySlotCount = (ship: Ship): number => {
    let empty = 0;
    for (const slot of ALL_GEAR_SLOT_KEYS) {
        if (!ship.equipment[slot]) empty++;
    }
    for (const slot of ALL_IMPLANT_SLOT_KEYS) {
        if (!ship.implants[slot]) empty++;
    }
    return empty;
};

export const hasEmptySlots = (ship: Ship): boolean => {
    return getEmptySlotCount(ship) > 0;
};
