/**
 * A parsed kit built from hand-written skill text, for boards whose bystanders need a specific
 * effect (a debuff seeder, a buff granter) without borrowing a real ship. The text MUST carry the
 * game's `<unit-skill>` / `<unit-damage>` tags or the parser builds no abilities.
 */
import type { ShipSkills } from '../../../types/abilities';
import type { Ship, Refit } from '../../../types/ship';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';

export interface TextKitTexts {
    active?: string;
    charged?: string;
    chargeCount?: number;
    passives?: string[];
}

export const textKit = (name: string, texts: TextKitTexts, refitCount = 0): ShipSkills => {
    const ship: Ship = {
        id: `text:${name}`,
        name,
        rarity: 'legendary',
        faction: 'MPL',
        type: 'ATTACKER',
        baseStats: {
            hp: 1e6,
            attack: 1000,
            defence: 0,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
        },
        equipment: {},
        implants: {},
        refits: Array.from({ length: refitCount }, () => ({}) as Refit),
        affinity: 'antimatter',
        activeSkillText: texts.active,
        chargeSkillText: texts.charged,
        chargeSkillCharge: texts.chargeCount ?? 0,
        firstPassiveSkillText: texts.passives?.[0],
        secondPassiveSkillText: texts.passives?.[1],
        thirdPassiveSkillText: texts.passives?.[2],
    };
    return buildShipAbilities(ship);
};
