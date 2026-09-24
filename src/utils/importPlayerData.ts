import { v4 as uuidv4 } from 'uuid';
import { ExportedPlayData } from '../types/exportedPlayData';
import { EngineeringStats, StatName, Stat } from '../types/stats';
import { Ship, Refit, AffinityName } from '../types/ship';
import { GearPiece } from '../types/gear';
import { isGearSlotName, isImplantSlotName } from '../constants/gearTypes';
import { GearSetName } from '../constants/gearSets';
import { ShipTypeName, isShipTypeName } from '../constants/shipTypes';
import { FactionName } from '../constants/factions';
import { calculateMainStatValue } from './gear/mainStatValueFetcher';
import {
    createStat,
    getPercentageStatValue,
    getStatName,
    getStatType,
} from './ship/gameStatVocabulary';
import {
    applyGuaranteedCrit,
    getDamageReduction,
    getHpRegen,
    padEmptyRefits,
} from './ship/perShipRules';

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
            acc: Partial<Record<ShipTypeName, { shipType: ShipTypeName; stats: Stat[] }>>,
            stat: ExportedPlayData['Engineering'][0]
        ) => {
            const shipType = getShipTypeName(stat.Type);
            if (!acc[shipType]) {
                acc[shipType] = {
                    shipType,
                    stats: [],
                };
            }
            acc[shipType].stats.push({
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
    const base = unit.Attributes.BaseWithLevelAndRank;
    return `${unit.Name}|${unit.Rarity}|${unit.Faction}|${unit.ShipType}|${unit.Affinity}|${unit.Rank}|${unit.Level}|${unit.Refit}|${base.HullPoints}|${base.Power}|${base.Defense}|${base.Manipulation}|${base.Security}|${base.CritChance}|${base.CritBoost}|${base.Initiative}`;
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
            damageReduction: getDamageReduction(unit.Name, unit.Refit),
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

        applyGuaranteedCrit(unit.Name, unit.Refit, refits, baseStats.crit);
        padEmptyRefits(refits);

        return {
            id: unit.Id,
            name: unit.Name,
            rarity: unit.Rarity.toLowerCase(),
            faction: getFaction(unit.Faction),
            type: getShipTypeName(unit.ShipType),
            affinity: getAffinity(unit.Affinity),
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

        if (isGearSlotName(slot)) {
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
                rarity: item.Rarity.toLowerCase(),
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
                setBonus: getSetBonus(item.Set),
                shipId: item.EquippedOnUnit || undefined,
            };

            // Detect calibration from export data (nil UUID means not calibrated)
            const NIL_UUID = '00000000-0000-0000-0000-000000000000';
            if (item.CalibratedForUnitId && item.CalibratedForUnitId !== NIL_UUID) {
                gearPiece.calibration = {
                    shipId: item.CalibratedForUnitId,
                };
                // Store base (uncalibrated) main stat value
                if (gearPiece.mainStat) {
                    const baseValue = calculateMainStatValue(
                        gearPiece.mainStat.name,
                        gearPiece.mainStat.type,
                        gearPiece.stars,
                        gearPiece.level
                    );
                    gearPiece.mainStat = {
                        ...gearPiece.mainStat,
                        value: baseValue,
                    };
                }
            }

            gear.push(gearPiece);
        } else if (isImplantSlotName(slot)) {
            implants.push({
                id: item.Id,
                slot,
                level: item.Level,
                stars: item.Rank,
                rarity: item.Rarity.toLowerCase(),
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
                setBonus: getImplantSetBonus(item.Set),
            });
        } else {
            // Neither a known gear slot nor a known implant slot — a game update added a slot
            // this importer doesn't know about yet, or the export is malformed. Drop the item
            // rather than writing an unvalidated string into a GearPiece.slot.
            console.warn(`Unrecognised equipment slot "${item.Slot}" — skipping item ${item.Id}`);
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

        // Build set of valid ship IDs for calibration validation
        const validShipIds = new Set(ships.map((s) => s.id));

        // Strip calibration references to ships that don't exist in the import
        // (e.g. ship was sold, or deduplicated away during transformShips)
        for (const g of gear) {
            if (g.calibration?.shipId && !validShipIds.has(g.calibration.shipId)) {
                delete g.calibration;
            }
        }

        // Build lookup maps for O(1) per-ship equipment assignment
        const gearByShip = new Map<string, GearPiece[]>();
        for (const g of gear) {
            if (g.shipId) {
                let list = gearByShip.get(g.shipId);
                if (!list) {
                    list = [];
                    gearByShip.set(g.shipId, list);
                }
                list.push(g);
            }
        }

        const implantsByShip = new Map<string, GearPiece[]>();
        for (const imp of implants) {
            if (imp.shipId) {
                let list = implantsByShip.get(imp.shipId);
                if (!list) {
                    list = [];
                    implantsByShip.set(imp.shipId, list);
                }
                list.push(imp);
            }
        }

        // Update equipment references in ships using map lookups. `gearByShip`/`implantsByShip`
        // are built solely from `gear`/`implants` above, so every `g.slot`/`imp.slot` here is
        // already the right kind — the guards just prove it to the type checker rather than
        // casting a `GearPiece.slot` (which spans both spaces) blindly into either one.
        for (const ship of ships) {
            const shipGear = gearByShip.get(ship.id);
            if (shipGear) {
                for (const g of shipGear) {
                    if (isGearSlotName(g.slot)) ship.equipment[g.slot] = g.id;
                }
            }
            const shipImplants = implantsByShip.get(ship.id);
            if (shipImplants) {
                for (const imp of shipImplants) {
                    if (isImplantSlotName(imp.slot)) ship.implants[imp.slot] = imp.id;
                }
            }
        }

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
        case 'Inc_Crit_Down':
            return 'HARDENED';
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

// The export only ever names one of the 4 base roles (never a subtype like DEBUFFER_BOMBER —
// those are assigned within this app, not by the game). A value outside `ShipTypeName` crosses
// the file-upload trust boundary (a corrupted export, or a role the game adds later), so it
// defaults to ATTACKER rather than crashing — the same fallback shape as `getFaction`/`getAffinity`.
const getShipTypeName = (shipType: string): ShipTypeName => {
    const upper = shipType.toUpperCase();
    return isShipTypeName(upper) ? upper : 'ATTACKER';
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
        // Both spellings: the game renamed the faction Tianchao -> Tianchen in its frontend, and an
        // unmapped value falls through to the TERRAN_COMBINE default below rather than erroring.
        case 'Tianchao':
        case 'Tianchen':
            return 'TIANCHAO';
        case 'XAOC':
            return 'XAOC';
        default:
            return 'TERRAN_COMBINE';
    }
};

// An alias mapper, not a validator: the export format spells the sensor slot "sensors"; every
// other slot (including every implant slot) passes through unchanged. The caller narrows the
// result with `isGearSlotName`/`isImplantSlotName` before trusting it as either union.
const getSlotName = (slot: string): string => {
    if (slot === 'sensors') return 'sensor';
    return slot;
};
