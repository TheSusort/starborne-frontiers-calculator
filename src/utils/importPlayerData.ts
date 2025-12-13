import { ExportedPlayData } from '../types/exportedPlayData';
import { EngineeringStats } from '../types/stats';
import { Ship, Refit } from '../types/ship';
import { GearPiece } from '../types/gear';
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
import { calculateMainStatValue } from './gear/mainStatValueFetcher';
import { getCalibratedMainStat, isCalibrationEligible } from './gear/calibrationCalculator';

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
    implants: GearPiece[];
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
            shieldPenetration: Math.round(
                unit.Attributes.BaseWithLevelAndRank.ShieldPenetration * 100
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

        // Add crit to Asphodel or Tormenter if they have more than 2 refits
        if ((unit.Name === 'Asphodel' || unit.Name === 'Tormenter') && refits.length > 2) {
            refits[0].stats.push(createStat('crit', 100 - baseStats.crit, 'percentage'));
        }

        // Check if refits have stats, if not, add an empty attack stat to each empty refit
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
            implants: {}, // Will be populated from equipment data
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
    const implants: GearPiece[] = [];

    items.forEach((item) => {
        const slot = getSlotName(item.Slot.toLowerCase());
        const isGear = Object.keys(GEAR_SLOTS).includes(slot);

        if (isGear) {
            const mainStatName = getStatName(item.MainStats[0].Attribute.Attribute) as StatName;
            const mainStatType = getStatType(
                item.MainStats[0].Attribute.Type,
                item.MainStats[0].Attribute.Attribute
            );
            const mainStatValue = getPercentageStatValue(
                item.MainStats[0].Attribute.Value,
                item.MainStats[0].Attribute.Type,
                item.MainStats[0].Attribute.Attribute
            );

            const gearPiece: GearPiece = {
                id: item.Id,
                slot,
                level: item.Level,
                stars: item.Rank,
                rarity: item.Rarity.toLowerCase() as RarityName,
                mainStat: createStat(mainStatName, mainStatValue, mainStatType),
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
            };

            // Detect calibration: if main stat value doesn't match expected base value
            // but matches calibrated value, and gear is equipped, mark as calibrated
            if (gearPiece.mainStat && isCalibrationEligible(gearPiece) && item.EquippedOnUnit) {
                const expectedBaseValue = calculateMainStatValue(
                    gearPiece.mainStat.name,
                    gearPiece.mainStat.type,
                    gearPiece.stars,
                    gearPiece.level
                );

                // If actual value doesn't match base, check if it matches calibrated
                if (Math.abs(gearPiece.mainStat.value - expectedBaseValue) > 0.1) {
                    // Create a temporary gear piece with base stat to calculate calibrated value
                    const baseGearPiece: GearPiece = {
                        ...gearPiece,
                        mainStat: {
                            ...gearPiece.mainStat,
                            value: expectedBaseValue,
                        },
                    };

                    // Check if actual value matches what calibrated would be
                    const calibratedStat = getCalibratedMainStat(baseGearPiece);
                    if (
                        calibratedStat &&
                        Math.abs(gearPiece.mainStat.value - calibratedStat.value) < 0.1
                    ) {
                        // This gear appears to be calibrated - mark it as calibrated to the equipped ship
                        gearPiece.calibration = {
                            shipId: item.EquippedOnUnit,
                        };
                        // Also update mainStat to base value for storage
                        gearPiece.mainStat = {
                            ...gearPiece.mainStat,
                            value: expectedBaseValue,
                        };
                    }
                }
            }

            gear.push(gearPiece);
        } else {
            implants.push({
                id: item.Id,
                slot: item.Slot.toLowerCase() as GearSlotName,
                level: item.Level,
                stars: item.Rank,
                rarity: item.Rarity.toLowerCase() as RarityName,
                mainStat: null,
                subStats: [...item.MainStats, ...item.SubStats].map((stat) =>
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
                shipId: item.EquippedOnUnit || undefined,
                setBonus: getImplantSetBonus(item.Set) as GearSetName,
            } as GearPiece);
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
                ship.implants[implant.slot] = implant.id;
            });
        });

        return {
            success: true,
            data: {
                engineeringStats,
                ships,
                inventory: [...gear, ...implants],
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

const getImplantSetBonus = (set: string): GearSetName | null => {
    switch (set) {
        // Ultimate
        case 'Implant_Ultimate_On_Hit_Dealt_While_Debuffed':
            return 'WARPSTRIKE';
        case 'Implant_Ultimate_On_Turn_Fill_Charge':
            return 'CHRONO_REAVER';
        case 'Implant_Ultimate_Out_Damage_Per_Debuff':
            return 'INTRUSION';
        case 'Implant_Ultimate_Startof_Combat_Security_To_Hacking':
            return 'CODE_GUARD';
        case 'Implant_Ultimate_On_Damage_Taken_From_Dots_Or_Bombs':
            return 'VORTEX_VEIL';
        case 'Implant_Ultimate_Extra_Repair_When_Less_Hp':
            return 'NOURISHMENT';
        case 'Implant_Ultimate_On_Enemy_Repaired_Speed_Up':
            return 'SYNAPTIC_RESONANCE';
        case 'Implant_Ultimate_On_Drop_Below_30_Shield':
            return 'LIFELINE';
        case 'Implant_Ultimate_On_Death_Disable':
            return 'MARTYRDOM';
        case 'Implant_Ultimate_On_Repair_Shield':
            return 'ABUNDANT_RENEWAL';
        case 'Implant_Ultimate_On_Hit_Taken_While_Stealthed':
            return 'VOIDSHADE';
        case 'Implant_Ultimate_Startof_Combat_Hacking_To_Security':
            return 'CIPHER_LINK';
        case 'Implant_Ultimate_On_Crit_Taken_From_Stealthed':
            return 'HYPERION_GAZE';
        case 'Implant_Ultimate_ON_Damage_Dealt_By_Bomb_Splash':
            return 'VOIDFIRE_CATALYST';
        case 'Implant_Ultimate_On_Hit_Dealt_While_Shielded':
            return 'ARCANE_SIEGE';
        case 'Implant_Ultimate_On_Hit_Taken_While_Stasised_Or_Disabled':
            return 'NEBULA_NULLIFIER';
        // Major
        case 'Implant_Major_On_Hit_Taken_Stealth':
            return 'SMOKESCREEN';
        case 'Implant_Major_On_Death_Repair':
            return 'LAST_WISH';
        case 'Implant_Major_On_Turn_Defense_Up':
            return 'FORTIFYING_SHROUD';
        case 'Implant_Major_On_Crit_Extra_Damage':
            return 'MENACE';
        case 'Implant_Major_On_Charged_Attack_Up':
            return 'SPEARHEAD';
        case 'Implant_Major_On_Hit_Higher_Attack_Extra_Damage':
            return 'GIANT_SLAYER';
        case 'Implant_Major_On_Debuff_Deal_Damage':
            return 'INSIDIOUSNESS';
        case 'Implant_Major_Startof_Round_Stealth_Crit_Dmg_Up':
            return 'AMBUSH';
        case 'Implant_Major_On_Ally_Damaged_Provoke':
            return 'BULWARK';
        case 'Implant_Major_On_Hit_Taken_Cleanse':
            return 'REACTIVE_WARD';
        case 'Implant_Major_Endof_Round_Contentrate_Fire':
            return 'DOOMSAYER';
        case 'Implant_Major_On_Debuffed_Block_Debuff':
            return 'FIREWALL';
        case 'Implant_Major_On_Debuff_Resist_Buff_Protection':
            return 'LOCKDOWN';
        case 'Implant_Major_On_Crit_Taken_Repair':
            return 'SECOND_WIND';
        case 'Implant_Major_On_Hit_Taken_Second_Time_Block_Damage':
            return 'IRONCLAD';
        case 'Implant_Major_On_Hit_Taken_Buff_Protection':
            return 'TENACITY';
        case 'Implant_Major_On_Repair_Extra_Repair':
            return 'VIVACIOUS_REPAIR';
        case 'Implant_Major_On_Repair_Share_Power':
            return 'FONT_OF_POWER';
        case 'Implant_Major_Last_Stand_Block_Damage':
            return 'LAST_STAND';
        case 'Implant_Major_On_Crit_Repair':
            return 'BLOODTHIRST';
        case 'Implant_Major_On_Hit_Taken_Shield':
            return 'ADAPTIVE_PLATING';
        case 'Implant_Major_On_Shield_Out_Crit_Dmg_Up':
            return 'RESONATING_FURY';
        case 'Implant_Major_On_Hit_Taken_Stealth_Block_Damage':
            return 'SHADOWGUARD';
        case 'Implant_Major_On_Death_Inc_Dmg_Down':
            return 'BATTLECRY';
        case 'Implant_Major_On_Repaired_Extra_Repair':
            return 'EXUBERANCE';
        case 'Implant_Major_Endof_Round_Speed_Up':
            return 'ALACRITY';
        // Minor Gamma
        case 'Implant_Minor_Gamma_CritChance_Flat':
            return 'PRECISION_GAMMA';
        case 'Implant_Minor_Gamma_Security_Flat':
            return 'SENTRY';
        case 'Implant_Minor_Gamma_Defense_Perc':
            return 'BARRIER';
        case 'Implant_Minor_Gamma_Manipulation_Flat':
            return 'OVERRIDE';
        case 'Implant_Minor_Gamma_Initiative_Flat':
            return 'HASTE_GAMMA';
        // Minor Sigma
        case 'Implant_Minor_Sigma_CritChance_Flat':
            return 'PRECISION';
        case 'Implant_Minor_Sigma_HullPoints_Flat':
            return 'CITADEL';
        case 'Implant_Minor_Sigma_Initiative_Flat':
            return 'HASTE';
        case 'Implant_Minor_Sigma_Power_Flat':
            return 'STRIKE';
        case 'Implant_Minor_Sigma_Power_Perc':
            return 'ONSLAUGHT';
        // Minor Alpha
        case 'Implant_Minor_Alpha_Power_Perc':
            return 'ONSLAUGHT_ALPHA';
        case 'Implant_Minor_Alpha_HullPoints_Perc':
            return 'BASTION';
        case 'Implant_Minor_Alpha_Defense_Flat':
            return 'GUARDIAN';
        case 'Implant_Minor_Alpha_CritBoost_Flat':
            return 'DEVASTATION';
        case 'Implant_Minor_Alpha_Manipulation_Flat':
            return 'OVERRIDE_ALPHA';
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
