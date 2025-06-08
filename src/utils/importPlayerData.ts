import { ExportedPlayData } from '../types/exportedPlayData';
import { EngineeringStats } from '../types/stats';
import { Ship, Refit } from '../types/ship';
import { GearPiece } from '../types/gear';
import { Implant } from '../types/ship';
import { GEAR_SLOTS, GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';
import {
    StatType,
    StatName,
    Stat,
    PERCENTAGE_ONLY_STATS,
    FlexibleStats,
    PercentageOnlyStats,
} from '../types/stats';
import { ShipTypeName } from '../constants/shipTypes';
import { FactionName } from '../constants/factions';
import { AffinityName } from '../types/ship';
import { v4 as uuidv4 } from 'uuid';

interface ImportResult {
    success: boolean;
    error?: string;
    data?: {
        engineeringStats: EngineeringStats;
        ships: Ship[];
        inventory: GearPiece[];
    };
}

interface TransformInventoryResult {
    gear: GearPiece[];
    implants: Implant[];
}

/**
 * Transforms exported engineering stats into our app's format
 */
const transformEngineeringStats = (data: ExportedPlayData['Engineering']): EngineeringStats => {
    const statsByShipType = data.reduce(
        (
            acc: Record<string, { shipType: ShipTypeName; stats: Stat[] }>,
            stat: ExportedPlayData['Engineering'][0]
        ) => {
            if (!acc[stat.Type.toUpperCase() as ShipTypeName]) {
                acc[stat.Type.toUpperCase() as ShipTypeName] = {
                    shipType: stat.Type.toUpperCase() as ShipTypeName,
                    stats: [],
                };
            }
            acc[stat.Type.toUpperCase() as ShipTypeName].stats.push({
                name: getStatName(stat.Attribute) as StatName,
                value: getPercentageStatValue(stat.Level, stat.ModifierType, stat.Attribute),
                type: getStatType(stat.ModifierType, stat.Attribute),
            } as Stat);
            return acc;
        },
        {}
    );

    return {
        stats: Object.values(statsByShipType),
    };
};

/**
 * Generates a unique key for a ship based on its properties (excluding ID)
 */
const generateShipKey = (unit: ExportedPlayData['Units'][0]): string => {
    return JSON.stringify({
        name: unit.Name,
        rarity: unit.Rarity,
        faction: unit.Faction,
        type: unit.ShipType,
        affinity: unit.Affinity,
        rank: unit.Rank,
        level: unit.Level,
        refit: unit.Refit,
        attributes: {
            base: unit.Attributes.BaseWithLevelAndRank,
            refit: unit.Attributes.Refit,
            engineering: unit.Attributes.Engineering,
        },
    });
};

/**
 * Transforms exported ships into our app's format
 */
const transformShips = (data: ExportedPlayData['Units']): Ship[] => {
    const shipMap = new Map<string, { ship: ExportedPlayData['Units'][0]; copies: number }>();

    // First pass: collect ships and count copies
    data.forEach((unit) => {
        const key = generateShipKey(unit);
        if (!shipMap.has(key)) {
            shipMap.set(key, { ship: unit, copies: 1 });
        } else {
            const entry = shipMap.get(key)!;
            entry.copies += 1;
        }
    });

    // Transform ships with their copy counts
    return Array.from(shipMap.values()).map(({ ship: unit, copies }) => {
        // Create array of empty refits based on unit.Refit
        const refits: Refit[] = Array.from({ length: unit.Refit }, () => ({
            id: uuidv4(),
            stats: [],
        }));

        const baseStats = {
            hp: unit.Attributes.BaseWithLevelAndRank.HullPoints,
            attack: unit.Attributes.BaseWithLevelAndRank.Power,
            defence: unit.Attributes.BaseWithLevelAndRank.Defense,
            hacking: unit.Attributes.BaseWithLevelAndRank.Manipulation,
            security: unit.Attributes.BaseWithLevelAndRank.Security,
            crit: Math.round(unit.Attributes.BaseWithLevelAndRank.CritChance * 100),
            critDamage: Math.round(unit.Attributes.BaseWithLevelAndRank.CritBoost * 100),
            speed: unit.Attributes.BaseWithLevelAndRank.Initiative,
            healModifier: 0, // Not present in exported data
            hpRegen: getHpRegen(unit.Name),
            shield: 0,
            defensePenetration: Math.round(
                unit.Attributes.BaseWithLevelAndRank.DefensePenetration * 100
            ),
        };

        // Distribute stats among refits
        unit.Attributes.Refit.forEach((refitStat, index) => {
            // Use modulo to cycle through refits if there are more stats than refits
            const refitIndex = index % refits.length;
            if (refits[refitIndex] && getStatName(refitStat.Attribute)) {
                refits[refitIndex].stats.push(
                    createStat(
                        getStatName(refitStat.Attribute) as StatName,
                        getPercentageStatValue(
                            refitStat.Value,
                            refitStat.Type,
                            refitStat.Attribute
                        ),
                        getStatType(refitStat.Type, refitStat.Attribute)
                    )
                );
            } else if (getStatName(refitStat.Attribute)) {
                baseStats[getStatName(refitStat.Attribute) as StatName] += getPercentageStatValue(
                    refitStat.Value,
                    refitStat.Type,
                    refitStat.Attribute
                );
            }
        });

        // TODO: Check if refits have stats, if not, add an empty attack stat to each empty refit
        refits.forEach((refit) => {
            if (refit.stats.length === 0) {
                refit.stats.push(createStat('attack', 0, 'flat'));
            }
        });

        return {
            id: unit.Id,
            name: unit.Name,
            rarity: unit.Rarity.toLowerCase() as RarityName,
            faction: getFaction(unit.Faction) as FactionName,
            type: unit.ShipType.toUpperCase() as ShipTypeName,
            affinity: getAffinity(unit.Affinity) as AffinityName,
            level: unit.Level,
            rank: unit.Rank,
            baseStats,
            equipment: {}, // Will be populated from equipment data
            refits,
            implants: [], // Will be populated from equipment data
            copies,
            equipmentLocked: false,
        };
    });
};

/**
 * Transforms exported equipment into our app's format
 */
function transformInventory(items: ExportedPlayData['Equipment']): TransformInventoryResult {
    const gear: GearPiece[] = [];
    const implants: Implant[] = [];

    items.forEach((item) => {
        const slot = getSlotName(item.Slot.toLowerCase());
        const isGear = Object.keys(GEAR_SLOTS).includes(slot);

        if (isGear) {
            gear.push({
                id: item.Id,
                slot,
                level: item.Level,
                stars: item.Rank,
                rarity: item.Rarity.toLowerCase() as RarityName,
                mainStat: createStat(
                    getStatName(item.MainStats[0].Attribute.Attribute) as StatName,
                    getPercentageStatValue(
                        item.MainStats[0].Attribute.Value,
                        item.MainStats[0].Attribute.Type,
                        item.MainStats[0].Attribute.Attribute
                    ),
                    getStatType(
                        item.MainStats[0].Attribute.Type,
                        item.MainStats[0].Attribute.Attribute
                    )
                ),
                subStats: item.SubStats.map((stat) =>
                    createStat(
                        getStatName(stat.Attribute.Attribute) as StatName,
                        getPercentageStatValue(
                            stat.Attribute.Value,
                            stat.Attribute.Type,
                            stat.Attribute.Attribute
                        ),
                        getStatType(stat.Attribute.Type, stat.Attribute.Attribute)
                    )
                ),
                setBonus: getSetBonus(item.Set) as GearSetName,
                shipId: item.EquippedOnUnit || undefined,
            });
        } else {
            implants.push({
                id: item.Id,
                stats: [...item.MainStats, ...item.SubStats].map((stat) =>
                    createStat(
                        getStatName(stat.Attribute.Attribute) as StatName,
                        getPercentageStatValue(
                            stat.Attribute.Value,
                            stat.Attribute.Type,
                            stat.Attribute.Attribute
                        ),
                        getStatType(stat.Attribute.Type, stat.Attribute.Attribute)
                    )
                ),
                description: item.Name,
                shipId: item.EquippedOnUnit || undefined,
            } as Implant);
        }
    });

    return { gear, implants };
}

/**
 * Imports player data from the exported JSON file
 */
export const importPlayerData = async (data: ExportedPlayData): Promise<ImportResult> => {
    try {
        // Transform the data
        const engineeringStats = transformEngineeringStats(data.Engineering);
        const { gear, implants } = transformInventory(data.Equipment);
        const ships = transformShips(data.Units);

        // Update equipment references in ships
        ships.forEach((ship) => {
            const shipEquipment = gear.filter((gear) => gear.shipId === ship.id);
            shipEquipment.forEach((gear) => {
                ship.equipment[gear.slot] = gear.id;
            });

            const shipImplants = implants.filter((implant) => implant.shipId === ship.id);
            shipImplants.forEach((implant) => {
                ship.implants.push(implant);
            });
        });

        return {
            success: true,
            data: {
                engineeringStats,
                ships,
                inventory: gear,
            },
        };
    } catch (error) {
        console.error('Error importing player data:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/** HELPER FUNCTIONS */

const getPercentageStatValue = (value: number, modifierType: string, attribute: string): number => {
    if (PERCENTAGE_ONLY_STATS.includes(getStatName(attribute) as PercentageOnlyStats)) {
        return Math.round(value * 100);
    }

    if (modifierType === 'Percentage') {
        return Math.round(value * 100);
    }
    return value;
};

const getStatType = (modifierType: string, attribute: string): StatType => {
    if (PERCENTAGE_ONLY_STATS.includes(getStatName(attribute) as PercentageOnlyStats)) {
        return 'percentage';
    }

    if (modifierType === 'Percentage') {
        return 'percentage';
    }
    return 'flat';
};

const getSetBonus = (set: GearSetName): GearSetName | null => {
    switch (set) {
        case 'HullPoints':
            return 'FORTITUDE';
        case 'Attack':
            return 'ATTACK';
        case 'Defense':
            return 'DEFENSE';
        case 'Defense_DebuffResistance':
            return 'PROTECTION';
        case 'Attack_Speed':
            return 'AMBUSH';
        case 'Critical':
            return 'CRITICAL';
        case 'Speed':
            return 'SPEED';
        case 'Buff_Durations':
            return 'BOOST';
        case 'Attack_On_Hit_Inferno_Origin':
            return 'BURNER';
        case 'DoT_Potency':
            return 'DECIMATION';
        case 'DebuffChance':
            return 'HACKING';
        case 'Hull_Leech':
            return 'LEECH';
        case 'Outgoing_Repair':
            return 'REPAIR';
        case 'Reflect':
            return 'REFLECT';
        case 'Berserk':
            return 'REVENGE';
        case 'Shield':
            return 'SHIELD';
        case 'Stealth':
            return 'CLOAKING';
        case 'Abyssal_Attack':
            return 'ABYSSAL_ASSAULT';
        case 'Abyssal_HullPoints':
            return 'ABYSSAL_SAFEGUARD';
        case 'Abyssal_Defense':
            return 'ABYSSAL_WARD';
        case 'Abyssal_DebuffChance':
            return 'ABYSSAL_BREACH';
        case 'Crafted_All_Stats':
            return 'OMNICORE';
        case 'Crafted_Speed':
            return 'SWIFTNESS';
        case 'Crafted_Outgoing_Repair':
            return 'RECOVERY';
        case 'Crafted_DebuffChance':
            return 'EXPLOIT';
        case 'Defense_Ignore':
            return 'PIERCER';
        default:
            return null;
    }
};

const getAffinity = (affinity: string): AffinityName => {
    switch (affinity) {
        case 'Blue':
            return 'electric';
        case 'Green':
            return 'chemical';
        case 'Red':
            return 'thermal';
        default:
            return 'antimatter';
    }
};

const getFaction = (faction: string): FactionName => {
    switch (faction) {
        case 'Atlas':
            return 'ATLAS_SYNDICATE';
        case 'Binderburg':
            return 'BINDERBURG';
        case 'Everliving':
            return 'EVERLIVING';
        case 'Legion':
            return 'FRONTIER_LEGION';
        case 'Gelecek':
            return 'GELECEK';
        case 'MPL':
            return 'MPL';
        case 'Marauders':
            return 'MARAUDERS';
        case 'Terran':
            return 'TERRAN_COMBINE';
        case 'Tianchao':
            return 'TIANCHAO';
        case 'XAOC':
            return 'XAOC';
        default:
            return 'TERRAN_COMBINE';
    }
};

const getSlotName = (slot: string): GearSlotName => {
    if (slot === 'sensors') return 'sensor';
    return slot;
};

function getStatName(exportStatName: string): StatName | null {
    switch (exportStatName) {
        case 'HullPoints':
            return 'hp';
        case 'Power':
            return 'attack';
        case 'Defense':
            return 'defence';
        case 'Manipulation':
            return 'hacking';
        case 'Security':
            return 'security';
        case 'CritChance':
            return 'crit';
        case 'CritBoost':
            return 'critDamage';
        case 'Initiative':
            return 'speed';
        case 'ShieldPoints':
            return 'shield';
        case 'DefensePenetration':
            return 'defensePenetration';
        default:
            return null;
    }
}

const getHpRegen = (name: string): number => {
    if (name === 'Isha') {
        return 5;
    } else if (name === 'Heliodor') {
        return 8;
    }
    return 0;
};

function createStat(name: StatName, value: number, type: StatType): Stat {
    if (PERCENTAGE_ONLY_STATS.includes(name as PercentageOnlyStats) || type === 'percentage') {
        return {
            name: name as PercentageOnlyStats | FlexibleStats,
            value,
            type: 'percentage',
        };
    }
    return {
        name: name as FlexibleStats,
        value,
        type: 'flat',
    };
}
