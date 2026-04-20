import { GearPiece } from '../../types/gear';
import {
    FlexibleStats,
    PERCENTAGE_ONLY_STATS,
    PercentageOnlyStats,
    Stat,
    StatName,
    StatType,
    EngineeringStat,
    BaseStats,
} from '../../types/stats';
import { calculatePriorityScore } from '../autogear/scoring';
import { ShipTypeName, GearSlotName } from '../../constants';
import { SUBSTAT_RANGES } from '../../constants/statValues';
import { calculateTotalStats, StatBreakdown } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';
import { UPGRADE_COSTS } from '../../constants/upgradeCosts';
import { Ship } from '../../types/ship';
import { calculateMainStatValue } from './mainStatValueFetcher';
import { isCalibrationEligible, getCalibratedMainStat } from './calibrationCalculator';

// Role-specific base stats representing typical ship base stats (before gear).
// Using midpoints of known ranges so percentage gear stats are weighted correctly.
const ROLE_BASE_STATS: Partial<Record<ShipTypeName, BaseStats>> = {
    ATTACKER: {
        hp: 22000,
        attack: 6250,
        defence: 5000,
        hacking: 0,
        security: 0,
        speed: 130,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEFENDER: {
        hp: 25000,
        attack: 3000,
        defence: 5000,
        hacking: 0,
        security: 90,
        speed: 110,
        crit: 10,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEBUFFER: {
        hp: 16500,
        attack: 4400,
        defence: 2500,
        hacking: 200,
        security: 33,
        speed: 125,
        crit: 12,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    SUPPORTER: {
        hp: 20000,
        attack: 3000,
        defence: 3250,
        hacking: 0,
        security: 0,
        speed: 99,
        crit: 12,
        critDamage: 22,
        healModifier: 0,
        defensePenetration: 0,
    },
};

// Map variant roles to their base role for dummy stats
function getBaseRoleStats(role: ShipTypeName): BaseStats {
    if (role.startsWith('DEFENDER')) return ROLE_BASE_STATS.DEFENDER!;
    if (role.startsWith('DEBUFFER')) return ROLE_BASE_STATS.DEBUFFER!;
    if (role.startsWith('SUPPORTER')) return ROLE_BASE_STATS.SUPPORTER!;
    return ROLE_BASE_STATS.ATTACKER!;
}

const UPGRADE_LEVELS = {
    rare: {
        increases: [4, 8] as number[],
        additions: [12, 16] as number[],
        initialSubstats: 2,
    },
    epic: {
        increases: [4, 8, 12] as number[],
        additions: [16] as number[],
        initialSubstats: 3,
    },
    legendary: {
        increases: [4, 8, 12, 16] as number[],
        additions: [] as number[],
        initialSubstats: 4,
    },
};

interface PotentialResult {
    piece: GearPiece;
    currentScore: number;
    potentialScore: number;
    improvement: number;
}

function getAvailableStats(
    currentSubStats: Stat[],
    mainStat: Stat
): { name: StatName; types: StatType[] }[] {
    const availableStats: { name: StatName; types: StatType[] }[] = [];

    Object.entries(SUBSTAT_RANGES).forEach(([statName, statConfig]) => {
        const availableTypes = Object.keys(statConfig).filter((type) => {
            return (
                !currentSubStats.some(
                    (s) => s.name === (statName as StatName) && s.type === type
                ) && !(mainStat.name === (statName as StatName) && mainStat.type === type)
            );
        });

        if (availableTypes.length > 0) {
            availableStats.push({
                name: statName as StatName,
                types: availableTypes as StatType[],
            });
        }
    });

    return availableStats;
}

function getSubstatIncrease(stat: Stat, rarity: string): number {
    const range = SUBSTAT_RANGES[stat?.name]?.[stat?.type];
    if (!range) return 0;

    const { min, max } = range[rarity as keyof typeof range];
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function simulateUpgrade(
    piece: GearPiece,
    targetLevel: number = 16
): { piece: GearPiece; cost: number } {
    if (piece.level >= targetLevel || piece.stars < 3) return { piece, cost: 0 };

    const config = UPGRADE_LEVELS[piece.rarity as keyof typeof UPGRADE_LEVELS];
    if (!config) return { piece, cost: 0 };

    const upgradedPiece = { ...piece };

    // Calculate main stat at target level
    const newMainStatValue = calculateMainStatValue(
        piece.mainStat?.name as StatName,
        piece.mainStat?.type as StatType,
        piece.stars,
        targetLevel
    );
    upgradedPiece.mainStat = { ...piece.mainStat, value: newMainStatValue } as Stat;

    // Simulate substat upgrades
    const newSubStats = [...piece.subStats];
    const remainingLevels = [];
    for (let level = piece.level + 4; level <= targetLevel; level += 4) {
        remainingLevels.push(level);
    }

    remainingLevels.forEach((level) => {
        if (config.additions.includes(level)) {
            const availableStats = getAvailableStats(newSubStats, piece.mainStat as Stat);

            if (availableStats.length > 0) {
                const randomStat =
                    availableStats[Math.floor(Math.random() * availableStats.length)];
                const randomType =
                    randomStat.types[Math.floor(Math.random() * randomStat.types.length)];

                if (SUBSTAT_RANGES[randomStat.name]?.[randomType]) {
                    const randomValue = getSubstatIncrease(
                        {
                            name: randomStat.name as FlexibleStats,
                            type: randomType,
                            value: 0,
                        } as Stat,
                        piece.rarity
                    );
                    newSubStats.push({
                        name: randomStat.name,
                        type: randomType,
                        value: randomValue,
                    } as Stat);
                }
            }
        } else if (config.increases.includes(level)) {
            if (newSubStats.length > 0) {
                const randomIndex = Math.floor(Math.random() * newSubStats.length);
                const stat = newSubStats[randomIndex];

                const increase = getSubstatIncrease(stat, piece.rarity);
                if (increase > 0) {
                    newSubStats[randomIndex] = {
                        ...stat,
                        value: stat.value + increase,
                    };
                }
            }
        }
    });

    upgradedPiece.subStats = newSubStats;
    upgradedPiece.level = targetLevel;

    return {
        piece: upgradedPiece,
        cost: calculateUpgradeCost(piece, targetLevel),
    };
}

export function calculateUpgradeCost(piece: GearPiece, targetLevel: number): number {
    const starCosts = UPGRADE_COSTS[piece.stars];
    if (!starCosts || targetLevel <= piece.level) return 0;
    const startCost = starCosts[piece.rarity];
    if (!startCost) return 0;

    const scale = 1.4019;
    const from = piece.level;
    const to = targetLevel;

    const cost =
        (startCost * Math.pow(scale, from) * (Math.pow(scale, to - from) - 1)) / (scale - 1);

    return Math.round(cost);
}
function calculateGearStats(
    piece: GearPiece,
    ship?: Ship,
    slot?: GearSlotName,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined,
    includePiece: boolean = true,
    cachedBaseline?: BaseStats | null,
    overrideBaseCrit?: number,
    shipRole?: ShipTypeName
): BaseStats {
    // If ship is provided, use ship's actual stats and equipment
    if (ship && getGearPiece && getEngineeringStatsForShipType) {
        // If we have cached baseline and we're not including the piece, return baseline directly
        if (cachedBaseline && !includePiece) {
            return cachedBaseline;
        }

        // Create equipment map without the slot being analyzed (if it has gear)
        const equipmentWithoutSlot: Partial<Record<GearSlotName, string>> = { ...ship.equipment };

        // Remove gear from the slot being analyzed (if analyzing a specific slot)
        // Also remove gear from the piece's slot if we're not including the piece
        if (slot && equipmentWithoutSlot[slot]) {
            delete equipmentWithoutSlot[slot];
        }

        // If the piece's slot is different from the analyzed slot, remove any existing gear there
        if (piece.slot !== slot && equipmentWithoutSlot[piece.slot]) {
            delete equipmentWithoutSlot[piece.slot];
        }

        // OPTIMIZATION: If we're including the piece, use cached baseline breakdown and incrementally add the piece
        // This is much faster than recalculating everything from scratch
        if (includePiece) {
            // Get or create cached baseline breakdown
            const breakdownCacheKey = `${ship.id}_${slot || piece.slot}_breakdown`;
            let baselineBreakdown = baselineBreakdownCache.get(breakdownCacheKey);

            if (!baselineBreakdown) {
                // Calculate and cache the baseline breakdown
                baselineBreakdown = calculateTotalStats(
                    ship.baseStats,
                    equipmentWithoutSlot,
                    getGearPiece,
                    ship.refits || [],
                    ship.implants || {},
                    getEngineeringStatsForShipType(ship.type),
                    ship.id
                );
                baselineBreakdownCache.set(breakdownCacheKey, baselineBreakdown);
            }

            // Start from the cached baseline and incrementally add the new piece
            const incrementalBreakdown: StatBreakdown = {
                base: { ...baselineBreakdown.base },
                afterRefits: { ...baselineBreakdown.afterRefits },
                afterEngineering: { ...baselineBreakdown.afterEngineering },
                afterGear: { ...baselineBreakdown.afterGear },
                afterSets: { ...baselineBreakdown.afterSets },
                final: { ...baselineBreakdown.final },
            };

            // Add the new piece's stats to afterGear
            const shouldApplyCalibration =
                ship.id && piece.calibration?.shipId === ship.id && isCalibrationEligible(piece);
            let mainStat = piece.mainStat;
            if (shouldApplyCalibration && mainStat) {
                mainStat = getCalibratedMainStat(piece);
            }

            // Helper function to add stat modifier (same logic as in statsCalculator)
            const addStatModifier = (stat: Stat, target: BaseStats, base: BaseStats) => {
                const isPercentageOnlyStat = PERCENTAGE_ONLY_STATS.includes(
                    stat.name as PercentageOnlyStats
                );

                if (isPercentageOnlyStat) {
                    target[stat.name] = (target[stat.name] || 0) + stat.value;
                } else if (stat.type === 'percentage') {
                    const baseValue = base[stat.name];
                    const bonus = (baseValue ?? 0) * (stat.value / 100);
                    target[stat.name] = (target[stat.name] || 0) + bonus;
                } else {
                    target[stat.name] = (target[stat.name] || 0) + stat.value;
                }
            };

            if (mainStat) {
                addStatModifier(
                    mainStat,
                    incrementalBreakdown.afterGear,
                    incrementalBreakdown.afterEngineering
                );
            }
            if (piece.subStats) {
                piece.subStats.forEach((stat) =>
                    addStatModifier(
                        stat,
                        incrementalBreakdown.afterGear,
                        incrementalBreakdown.afterEngineering
                    )
                );
            }

            // Update afterSets to include the new piece's gear stats
            Object.assign(incrementalBreakdown.afterSets, incrementalBreakdown.afterGear);

            // Recalculate set bonuses - need to check if adding this piece changes set counts
            const setCountsBefore: Record<string, number> = {};
            Object.values(equipmentWithoutSlot).forEach((gearId) => {
                if (!gearId) return;
                const gear = getGearPiece(gearId);
                if (!gear?.setBonus) return;
                setCountsBefore[gear.setBonus] = (setCountsBefore[gear.setBonus] || 0) + 1;
            });

            const setCountsAfter: Record<string, number> = { ...setCountsBefore };
            if (piece.setBonus) {
                setCountsAfter[piece.setBonus] = (setCountsAfter[piece.setBonus] || 0) + 1;
            }

            // Apply set bonus changes
            Object.keys(setCountsAfter).forEach((setType) => {
                const countBefore = setCountsBefore[setType] || 0;
                const countAfter = setCountsAfter[setType] || 0;
                const bonusCountBefore = Math.floor(
                    countBefore / (GEAR_SETS[setType]?.minPieces || 2)
                );
                const bonusCountAfter = Math.floor(
                    countAfter / (GEAR_SETS[setType]?.minPieces || 2)
                );

                if (bonusCountAfter > bonusCountBefore && GEAR_SETS[setType]?.stats) {
                    // Halve the set bonus contribution for 4-piece sets since they're harder to complete
                    const setScaleFactor = (GEAR_SETS[setType]?.minPieces || 2) >= 4 ? 0.5 : 1;
                    // New set bonus activated - apply it
                    for (let i = 0; i < bonusCountAfter - bonusCountBefore; i++) {
                        GEAR_SETS[setType].stats.forEach((stat) =>
                            addStatModifier(
                                { ...stat, value: stat.value * setScaleFactor },
                                incrementalBreakdown.afterSets,
                                incrementalBreakdown.afterEngineering
                            )
                        );
                    }
                }
            });

            // Implants are already in the baseline, so final stats are the same as afterSets
            Object.assign(incrementalBreakdown.final, incrementalBreakdown.afterSets);

            return incrementalBreakdown.final;
        }

        // Fallback to full recalculation if not including piece (shouldn't happen often)
        const breakdown = calculateTotalStats(
            ship.baseStats,
            equipmentWithoutSlot,
            getGearPiece,
            ship.refits || [],
            ship.implants || {},
            getEngineeringStatsForShipType(ship.type),
            ship.id
        );

        return breakdown.final;
    }

    // Fallback to dummy-based calculation using role-specific base stats
    const roleStats = shipRole ? getBaseRoleStats(shipRole) : ROLE_BASE_STATS.ATTACKER!;

    // Use overrideBaseCrit if provided (ensures consistent baseline across current vs upgraded comparisons)
    // Otherwise calculate from this piece's crit
    let baseCrit: number;
    if (overrideBaseCrit !== undefined) {
        baseCrit = overrideBaseCrit;
    } else {
        let totalGearCrit = 0;
        if (piece.mainStat?.name === 'crit') {
            totalGearCrit += piece.mainStat.value;
        }
        piece.subStats?.forEach((stat) => {
            if (stat.name === 'crit') {
                totalGearCrit += stat.value;
            }
        });
        baseCrit = Math.max(0, 100 - totalGearCrit);
    }

    const breakdown = calculateTotalStats(
        {
            ...roleStats,
            crit: baseCrit,
        },
        // Single piece of gear
        { [piece.slot]: piece.id },
        // Gear piece getter
        (id) => (id === piece.id ? piece : undefined),
        // No refits, implants, or engineering
        [],
        {},
        undefined
    );

    // Add set bonus stats if the piece has a set
    // Note: We apply set bonus optimistically (assuming set will be complete)
    // This is for ranking purposes - in reality, set bonus only applies with minPieces
    if (piece.setBonus && GEAR_SETS[piece.setBonus]) {
        const setBonus = GEAR_SETS[piece.setBonus];
        // Halve the set bonus contribution for 4-piece sets since they're harder to complete
        const setScaleFactor = (setBonus.minPieces || 2) >= 4 ? 0.5 : 1;
        if (setBonus.stats) {
            // Use the base stats (afterEngineering) for percentage calculations
            // This matches how addStatModifier works in calculateTotalStats
            const baseStats = breakdown.afterEngineering;
            setBonus.stats.forEach((stat) => {
                const scaledValue = stat.value * setScaleFactor;
                const isPercentageOnlyStat = PERCENTAGE_ONLY_STATS.includes(
                    stat.name as PercentageOnlyStats
                );

                if (isPercentageOnlyStat) {
                    // For percentage-only stats (crit, critDamage, etc.), add directly
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + scaledValue;
                } else if (stat.type === 'percentage') {
                    // For percentage stats on flexible stats (attack, hp, etc.), calculate from base
                    const baseValue = baseStats[stat.name] || 0;
                    const bonus = baseValue * (scaledValue / 100);
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + bonus;
                } else {
                    // For flat stats, add directly
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + scaledValue;
                }
            });
        }
    }

    return breakdown.final;
}

// Helper function to get all stats present on a piece (main + substats)
function getPieceStats(piece: GearPiece): StatName[] {
    const stats: StatName[] = [];

    if (piece.mainStat) {
        stats.push(piece.mainStat.name);
    }

    if (piece.subStats) {
        piece.subStats.forEach((substat) => {
            stats.push(substat.name);
        });
    }

    return stats;
}

// Helper function to check if a piece matches selected stats based on mode
function pieceHasSelectedStats(
    piece: GearPiece,
    selectedStats: StatName[],
    mode: 'AND' | 'OR'
): boolean {
    if (selectedStats.length === 0) return true; // No filter if no stats selected

    const pieceStats = getPieceStats(piece);

    if (mode === 'AND') {
        // Piece must have ALL selected stats
        return selectedStats.every((stat) => pieceStats.includes(stat));
    } else {
        // Piece must have at least ONE selected stat (OR mode)
        return selectedStats.some((stat) => pieceStats.includes(stat));
    }
}

// Helper function to add bonus weight if main stat matches selected stats
function getMainStatBonus(piece: GearPiece, selectedStats: StatName[], baseScore: number): number {
    if (selectedStats.length === 0 || !piece.mainStat) return 0;

    // If main stat is one of the selected stats, add significant bonus
    if (selectedStats.includes(piece.mainStat.name)) {
        // Add 50% bonus to the base score for main stat match
        return baseScore * 0.5;
    }

    return 0;
}

// Cache for baseline stats when analyzing a specific slot with a ship
// Key: `${shipId}_${slot}` or `${shipId}_all` for all slots
// This cache persists across calls within an analysis session so "all" can reuse baselines from individual slots
export const baselineStatsCache = new Map<string, BaseStats>();

// Cache for baseline breakdown (full StatBreakdown) - much more efficient for incremental calculations
// Key: `${shipId}_${slot}_breakdown`
// Persists across calls within an analysis session so "all" can reuse breakdowns from individual slots.
//
// SHARED OWNERSHIP: both the slow path (this module) and the fast path
// (gear/fastPotential/potentialContext.ts) write to this Map under the same
// key format. The sharing is intentional — it lets VERIFY_FAST_POTENTIAL runs
// stay coherent. Tests that exercise either path must clear this cache
// (alongside baselineStatsCache) in beforeEach to avoid cross-test leakage.
export const baselineBreakdownCache = new Map<string, StatBreakdown>();

// Cache for gear stats calculations
// Key: `${pieceId}_${includePiece}_${slot || 'all'}`
const gearStatsCache = new Map<string, BaseStats>();

export function analyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20,
    selectedStats: StatName[] = [],
    statFilterMode: 'AND' | 'OR' = 'AND',
    selectedGearSets: string[] = [],
    ship?: Ship,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined
): PotentialResult[] {
    // Clear per-call caches; baseline caches persist across calls so "all" can reuse individual slot results
    gearStatsCache.clear();
    const rarityOrder = ['rare', 'epic', 'legendary'];
    const minRarityIndex = rarityOrder.indexOf(minRarity);
    const eligibleRarities = rarityOrder.slice(minRarityIndex);

    const eligiblePieces = inventory.filter(
        (piece) =>
            piece.level < 16 &&
            eligibleRarities.includes(piece.rarity) &&
            !piece.slot.includes('implant') &&
            (!slot || piece.slot === slot) &&
            pieceHasSelectedStats(piece, selectedStats, statFilterMode) &&
            (selectedGearSets.length === 0 ||
                (piece.setBonus && selectedGearSets.includes(piece.setBonus)))
    );

    // Cache baseline stats when analyzing with a ship
    // When analyzing a specific slot, cache that slot's baseline
    // When analyzing "all", pre-cache baselines for all slots that have eligible pieces
    let cachedBaselineStats: BaseStats | null = null;
    if (ship && slot && getGearPiece && getEngineeringStatsForShipType) {
        // Analyzing a specific slot - cache the baseline for this slot
        const cacheKey = `${ship.id}_${slot}`;
        if (baselineStatsCache.has(cacheKey)) {
            cachedBaselineStats = baselineStatsCache.get(cacheKey)!;
        } else {
            // Calculate baseline once - ship stats without gear in the analyzed slot
            const equipmentWithoutSlot: Partial<Record<GearSlotName, string>> = {
                ...ship.equipment,
            };
            if (equipmentWithoutSlot[slot]) {
                delete equipmentWithoutSlot[slot];
            }
            const baselineBreakdown = calculateTotalStats(
                ship.baseStats,
                equipmentWithoutSlot,
                getGearPiece,
                ship.refits || [],
                ship.implants || {},
                getEngineeringStatsForShipType(ship.type),
                ship.id
            );
            cachedBaselineStats = baselineBreakdown.final;
            baselineStatsCache.set(cacheKey, cachedBaselineStats);
        }
    } else if (ship && !slot && getGearPiece && getEngineeringStatsForShipType) {
        // Analyzing "all" - pre-cache baselines for all slots that have eligible pieces
        // This way when we process pieces, the baselines are already cached
        const slotsToCache = new Set<GearSlotName>();
        eligiblePieces.forEach((piece) => {
            if (piece.slot && !piece.slot.includes('implant')) {
                slotsToCache.add(piece.slot);
            }
        });

        slotsToCache.forEach((slotToCache) => {
            const cacheKey = `${ship.id}_${slotToCache}`;
            if (!baselineStatsCache.has(cacheKey)) {
                const equipmentWithoutSlot: Partial<Record<GearSlotName, string>> = {
                    ...ship.equipment,
                };
                if (equipmentWithoutSlot[slotToCache]) {
                    delete equipmentWithoutSlot[slotToCache];
                }
                const baselineBreakdown = calculateTotalStats(
                    ship.baseStats,
                    equipmentWithoutSlot,
                    getGearPiece,
                    ship.refits || [],
                    ship.implants || {},
                    getEngineeringStatsForShipType(ship.type),
                    ship.id
                );
                baselineStatsCache.set(cacheKey, baselineBreakdown.final);
            }
        });
    }

    // Only calculate for the selected role, not all roles
    const rolesToScore = [shipRole];

    const results: PotentialResult[] = eligiblePieces.map((piece) => {
        // Calculate current stats - if ship is provided, use ship's stats without this piece
        // Otherwise use dummy-based calculation
        // Use cached baseline if available (for specific slot analysis or "all" analysis)
        let currentStats: BaseStats;

        // For the dummy path, compute baseCrit once from the CURRENT piece's crit.
        // This same baseCrit is used for both current and upgraded comparisons so that
        // crit improvements are properly weighted (upgraded piece with more crit scores higher).
        let pieceCritBaseline: number | undefined;
        if (!ship) {
            let totalGearCrit = 0;
            if (piece.mainStat?.name === 'crit') {
                totalGearCrit += piece.mainStat.value;
            }
            piece.subStats?.forEach((stat) => {
                if (stat.name === 'crit') {
                    totalGearCrit += stat.value;
                }
            });
            pieceCritBaseline = Math.max(0, 100 - totalGearCrit);
        }

        // Try to get cached baseline for this piece's slot (works for both specific slot and "all" analysis)
        let pieceBaseline: BaseStats | null = null;
        if (ship && piece.slot && !piece.slot.includes('implant')) {
            const pieceSlotCacheKey = `${ship.id}_${piece.slot}`;
            if (baselineStatsCache.has(pieceSlotCacheKey)) {
                pieceBaseline = baselineStatsCache.get(pieceSlotCacheKey)!;
            }
        }

        if (cachedBaselineStats) {
            // Use cached baseline stats (ship without gear in the analyzed slot)
            currentStats = cachedBaselineStats;
        } else if (pieceBaseline) {
            // Use cached baseline for this piece's slot (when analyzing "all")
            currentStats = pieceBaseline;
        } else {
            // Calculate normally
            const cacheKey = `${piece.id}_false_${slot || 'all'}`;
            if (gearStatsCache.has(cacheKey)) {
                currentStats = gearStatsCache.get(cacheKey)!;
            } else {
                currentStats = calculateGearStats(
                    piece,
                    ship,
                    slot,
                    getGearPiece,
                    getEngineeringStatsForShipType,
                    false, // Don't include the piece for current stats
                    pieceBaseline || cachedBaselineStats,
                    pieceCritBaseline,
                    shipRole
                );
                gearStatsCache.set(cacheKey, currentStats);
            }
        }

        let currentScore = 0;
        rolesToScore.forEach((role) => {
            const baseCurrentScore = calculatePriorityScore(currentStats, [], role);
            const mainStatBonusCurrent = getMainStatBonus(piece, selectedStats, baseCurrentScore);
            currentScore += baseCurrentScore + mainStatBonusCurrent;
        });
        // Average the scores across roles
        currentScore = currentScore / rolesToScore.length;

        const simulations = Array.from({ length: simulationCount }, () => {
            const { piece: upgradedPiece } = simulateUpgrade(piece);

            // Calculate upgraded stats (no caching needed since each simulation is unique)
            // Try to get cached baseline for this piece's slot
            let upgradedPieceBaseline: BaseStats | null = null;
            if (ship && upgradedPiece.slot && !upgradedPiece.slot.includes('implant')) {
                const upgradedPieceSlotCacheKey = `${ship.id}_${upgradedPiece.slot}`;
                if (baselineStatsCache.has(upgradedPieceSlotCacheKey)) {
                    upgradedPieceBaseline = baselineStatsCache.get(upgradedPieceSlotCacheKey)!;
                }
            }

            const upgradedStats = calculateGearStats(
                upgradedPiece,
                ship,
                slot,
                getGearPiece,
                getEngineeringStatsForShipType,
                true, // Include the upgraded piece for potential stats
                upgradedPieceBaseline || cachedBaselineStats,
                pieceCritBaseline, // Same baseline crit as current piece for fair comparison
                shipRole
            );

            let potentialScore = 0;
            rolesToScore.forEach((role) => {
                const basePotentialScore = calculatePriorityScore(upgradedStats, [], role);
                const mainStatBonusPotential = getMainStatBonus(
                    upgradedPiece,
                    selectedStats,
                    basePotentialScore
                );
                potentialScore += basePotentialScore + mainStatBonusPotential;
            });
            // Average the scores across roles
            potentialScore = potentialScore / rolesToScore.length;

            return { piece: upgradedPiece, score: potentialScore };
        });

        const avgPotentialScore =
            simulations.reduce((sum, sim) => sum + sim.score, 0) / simulations.length;

        return {
            piece,
            currentScore,
            potentialScore: avgPotentialScore,
            improvement: avgPotentialScore - currentScore,
        };
    });

    const sortedResults = results
        .sort((a, b) => b.potentialScore - a.potentialScore)
        .slice(0, count);

    return sortedResults;
}
