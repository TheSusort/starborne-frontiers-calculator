import { useCallback } from 'react';
import { GearPiece } from '../types/gear';
import { useStorage } from './useStorage';
import { StorageKey } from '../constants/storage';
import { simulateUpgrade } from '../utils/gear/potentialCalculator';
import { StatName, StatType } from '../types/stats';
import { useInventory } from '../contexts/InventoryProvider';

interface Upgrade {
    mainStat: {
        name: string;
        value: number;
        type: string;
    };
    subStats: {
        name: string;
        value: number;
        type: string;
    }[];
}

interface Upgrades {
    [key: string]: Upgrade;
}

export const useGearUpgrades = () => {
    const { getGearPiece } = useInventory();
    const { data: storageUpgrades, setData: setStorageUpgrades } = useStorage<Upgrades>({
        key: StorageKey.GEAR_UPGRADES,
        defaultValue: {},
    });

    const simulateUpgrades = useCallback(
        async (inventory: GearPiece[]) => {
            // eslint-disable-next-line no-console
            console.log('Starting upgrade simulation with inventory:', inventory.length);

            const newUpgrades: Upgrades = {};

            // Process all eligible pieces from inventory
            for (const piece of inventory) {
                //console.log(`Processing piece: ${piece.id}`);

                // Skip if piece is already at max level
                if (piece.level >= 16) {
                    // eslint-disable-next-line no-console
                    console.log(`Skipping piece ${piece.id} - already at max level`);
                    continue;
                }

                // Skip if piece is below rare rarity
                if (!['rare', 'epic', 'legendary'].includes(piece.rarity)) {
                    // eslint-disable-next-line no-console
                    console.log(`Skipping piece ${piece.id} - below rare rarity`);
                    continue;
                }

                // Skip if piece is an implant
                if (piece.slot.includes('implant')) {
                    // eslint-disable-next-line no-console
                    console.log(`Skipping piece ${piece.id} - is an implant`);
                    continue;
                }

                // Skip if piece has no main stat
                if (!piece.mainStat) {
                    // eslint-disable-next-line no-console
                    console.log(`Skipping piece ${piece.id} - no main stat`);
                    continue;
                }

                // Simulate the upgrade using the potentialCalculator
                const upgradedPiece = simulateUpgrade(piece);

                // Store the upgrade
                newUpgrades[piece.id] = {
                    mainStat: {
                        name: upgradedPiece.mainStat?.name as StatName,
                        value: upgradedPiece.mainStat?.value as number,
                        type: upgradedPiece.mainStat?.type as StatType,
                    },
                    subStats: upgradedPiece.subStats,
                };

                //console.log(`Saved upgrade for piece ${piece.id}`);
            }

            // eslint-disable-next-line no-console
            console.log(`Total upgrades saved: ${Object.keys(newUpgrades).length}`);
            await setStorageUpgrades(newUpgrades);
        },
        [setStorageUpgrades]
    );

    const clearUpgrades = useCallback(async () => {
        await setStorageUpgrades({});
    }, [setStorageUpgrades]);

    const getUpgrade = useCallback(
        (id: string) => {
            return storageUpgrades?.[id];
        },
        [storageUpgrades]
    );

    const getUpgradedGearPiece = useCallback(
        (id: string): GearPiece | undefined => {
            const upgrade = getUpgrade(id);
            const piece = getGearPiece(id);
            if (!piece) return undefined;
            return upgrade ? ({ ...piece, ...upgrade } as GearPiece) : piece;
        },
        [getUpgrade, getGearPiece]
    );

    return {
        upgrades: storageUpgrades || {},
        simulateUpgrades,
        clearUpgrades,
        getUpgrade,
        getUpgradedGearPiece,
    };
};
