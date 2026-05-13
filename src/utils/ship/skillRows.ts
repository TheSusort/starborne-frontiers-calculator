import { Ship } from '../../types/ship';

export interface SkillRow {
    label: string;
    text: string;
    charge?: number;
}

export function getShipSkillRows(ship: Ship): SkillRow[] {
    const refitCount = ship.refits.length;
    const activePassive: SkillRow | null =
        refitCount >= 4 && ship.thirdPassiveSkillText
            ? { label: 'Passive R4', text: ship.thirdPassiveSkillText }
            : refitCount >= 2 && ship.secondPassiveSkillText
              ? { label: 'Passive R2', text: ship.secondPassiveSkillText }
              : refitCount >= 1 && ship.firstPassiveSkillText
                ? { label: 'Passive R1', text: ship.firstPassiveSkillText }
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
