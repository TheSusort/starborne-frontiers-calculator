import { GEAR_SLOTS, type GearSlotName } from '../../constants/gearTypes';
import { StatName } from '../../types/stats';

/** Stat names a main stat can roll as on any of `slots`; every gear main stat when none is selected. */
export function getAllowedMainStatNames(slots: GearSlotName[]): Set<StatName> {
    const pool = slots.length > 0 ? slots : (Object.keys(GEAR_SLOTS) as GearSlotName[]);
    const names = new Set<StatName>();
    for (const slot of pool) {
        for (const name of GEAR_SLOTS[slot].availableMainStats as readonly StatName[]) {
            names.add(name);
        }
    }
    return names;
}

/** Keeps the `name:type` main-stat keys whose stat can roll on `slots`. */
export function filterMainStatKeys(keys: string[], slots: GearSlotName[]): string[] {
    const allowed = getAllowedMainStatNames(slots);
    return keys.filter((key) => allowed.has(key.split(':')[0] as StatName));
}
