import { BaseStats } from '../types/stats';
import { SHIPS } from '../constants/ships';
export interface ParsedShipData {
    baseStats: BaseStats;
    faction: string;
    type: string;
    rarity: string;
    affinity: string;
}

export async function fetchShipData(shipName: string): Promise<ParsedShipData | null> {
    // fetch ship data from constant ships
    const shipData = SHIPS[shipName.toUpperCase().replace(' ', '_') as keyof typeof SHIPS];
    if (!shipData) {
        return null;
    }

    const parsedShipData: ParsedShipData = {
        baseStats: {
            hp: shipData.hp,
            attack: shipData.attack,
            defence: shipData.defense,
            hacking: shipData.hacking,
            security: shipData.security,
            crit: shipData.critRate,
            critDamage: shipData.critDamage,
            speed: shipData.speed,
            healModifier: 0,
        },
        faction: shipData.faction.toUpperCase().replace(' ', '_'),
        type: shipData.role.toUpperCase(),
        rarity: shipData.rarity.toLowerCase(),
        affinity: shipData.affinity.toUpperCase(),
    };

    return parsedShipData;
}
