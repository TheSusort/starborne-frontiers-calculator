import { Ship } from '../../types/ship';

export interface SkillRow {
    label: string;
    text: string;
    charge?: number;
}

export function getShipSkillRows(ship: Ship): SkillRow[] {
    const refitCount = ship.refits.length;
    // The highest-unlocked passive applies. R4 needs 4 refits, R2 needs 2; the base passive
    // (R0) is innate and applies even on an unrefit ship — so it must NOT be gated behind a
    // refit count, or unrefit ships (e.g. FrontLine) surface no passive at all.
    const activePassive: SkillRow | null =
        refitCount >= 4 && ship.thirdPassiveSkillText
            ? { label: 'Passive R4', text: ship.thirdPassiveSkillText }
            : refitCount >= 2 && ship.secondPassiveSkillText
              ? { label: 'Passive R2', text: ship.secondPassiveSkillText }
              : ship.firstPassiveSkillText
                ? { label: 'Passive R0', text: ship.firstPassiveSkillText }
                : null;

    return [
        { label: 'Active', text: ship.activeSkillText ?? '' },
        {
            label: 'Charge',
            text: ship.chargeSkillText ?? '',
            charge: ship.chargeSkillCharge,
        },
        ...(activePassive ? [activePassive] : []),
    ].filter((row) => row.text.length > 0);
}

/**
 * Returns the skill-reference row matching an editor skill slot:
 * active → 'Active', charged → 'Charge', passive → the refit-active 'Passive R*' row.
 * Undefined when the ship has no text for that slot.
 */
export function getSkillRowForSlot(
    ship: Ship,
    slot: 'active' | 'charged' | 'passive'
): SkillRow | undefined {
    const rows = getShipSkillRows(ship);
    if (slot === 'active') return rows.find((r) => r.label === 'Active');
    if (slot === 'charged') return rows.find((r) => r.label === 'Charge');
    return rows.find((r) => r.label.startsWith('Passive'));
}
