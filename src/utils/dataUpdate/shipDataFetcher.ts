import { BaseStats } from '../../types/stats';
import { shipsService } from '../../services/firebase/ships';
export interface ParsedShipData {
    baseStats: BaseStats;
    faction: string;
    type: string;
    rarity: string;
    affinity: string;
}

export async function fetchShipData(shipName: string): Promise<ParsedShipData | null> {
    if (!shipName || shipName.trim() === '') {
        console.error('Invalid ship name provided');
        return null;
    }

    try {
        // Fetch the ship directly by name from Firestore
        const shipData = await shipsService.getShipByName(shipName);

        if (!shipData) {
            // eslint-disable-next-line no-console
            console.warn(`Ship not found in Firestore: ${shipName}`);
            return null;
        }

        const parsedShipData: ParsedShipData = {
            baseStats: {
                ...shipData.baseStats,
                // Ensure all required properties are present
                healModifier: shipData.baseStats.healModifier || 0,
                hpRegen: shipData.baseStats.hpRegen || 0,
            },
            faction: shipData.faction,
            type: shipData.type,
            rarity: shipData.rarity,
            affinity: shipData.affinity || 'chemical', // Default to chemical if not available
        };

        // eslint-disable-next-line no-console
        console.log(`Successfully fetched ship data for: ${shipName}`);
        return parsedShipData;
    } catch (error) {
        console.error(`Error fetching ship data from Firestore for ${shipName}:`, error);
        return null;
    }
}
