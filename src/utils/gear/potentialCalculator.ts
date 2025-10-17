import { GearPiece } from '../../types/gear';
import {
    FlexibleStats,
    PERCENTAGE_ONLY_STATS,
    PercentageOnlyStats,
    Stat,
    StatName,
    StatType,
} from '../../types/stats';
import { calculateMainStatValue } from './mainStatValueFetcher';
import { calculatePriorityScore } from '../autogear/scoring';
import { ShipTypeName, GearSlotName } from '../../constants';
import { SUBSTAT_RANGES } from '../../constants/statValues';
import { BaseStats } from '../../types/stats';
import { calculateTotalStats, clearGearStatsCache } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';
import { UPGRADE_COSTS } from '../../constants/upgradeCosts';

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
    // Clear the gear stats cache to ensure fresh calculations for this simulation
    clearGearStatsCache();

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

function calculateUpgradeCost(piece: GearPiece, targetLevel: number): number {
    const startCost = UPGRADE_COSTS[piece.stars][piece.rarity];
    if (!startCost || targetLevel <= piece.level) return 0;

    const scale = 1.4019;
    const from = piece.level;
    const to = targetLevel;

    const cost =
        (startCost * Math.pow(scale, from) * (Math.pow(scale, to - from) - 1)) / (scale - 1);

    return Math.round(cost);
}
function calculateGearStats(piece: GearPiece): BaseStats {
    // Calculate total crit from this gear piece for crit-capping
    let totalGearCrit = 0;
    if (piece.mainStat?.name === 'crit') {
        totalGearCrit += piece.mainStat.value;
    }
    piece.subStats?.forEach((stat) => {
        if (stat.name === 'crit') {
            totalGearCrit += stat.value;
        }
    });

    // Adjust base crit so that final crit = 100% (crit-capped)
    // Base crit = 100 - gear crit, ensuring the piece is evaluated as if it brings you to 100% crit
    const baseCrit = Math.max(0, 100 - totalGearCrit);

    const breakdown = calculateTotalStats(
        // Empty base stats with adjusted crit for crit-capping
        {
            hp: 22000,
            attack: 6000,
            defence: 5000,
            hacking: 100,
            security: 100,
            speed: 100,
            crit: baseCrit,
            critDamage: 100,
            healModifier: 0,
            defensePenetration: 0,
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
    if (piece.setBonus && GEAR_SETS[piece.setBonus]) {
        const setBonus = GEAR_SETS[piece.setBonus];
        if (setBonus.stats) {
            setBonus.stats.forEach((stat) => {
                const currentValue = breakdown.final[stat.name] || 0;
                if (
                    stat.type === 'percentage' &&
                    !PERCENTAGE_ONLY_STATS.includes(stat.name as PercentageOnlyStats)
                ) {
                    breakdown.final[stat.name] = currentValue * (1 + stat.value / 100);
                } else {
                    breakdown.final[stat.name] = currentValue + stat.value;
                }
            });
        }
    }

    return breakdown.final;
}

export function analyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20
): PotentialResult[] {
    // Clear the gear stats cache to ensure we get fresh calculations for each simulation
    clearGearStatsCache();

    const rarityOrder = ['rare', 'epic', 'legendary'];
    const minRarityIndex = rarityOrder.indexOf(minRarity);
    const eligibleRarities = rarityOrder.slice(minRarityIndex);

    const eligiblePieces = inventory.filter(
        (piece) =>
            piece.level < 16 &&
            eligibleRarities.includes(piece.rarity) &&
            !piece.slot.includes('implant') &&
            (!slot || piece.slot === slot)
    );

    const results: PotentialResult[] = eligiblePieces.map((piece) => {
        const currentStats = calculateGearStats(piece);
        const currentScore = calculatePriorityScore(currentStats, [], shipRole);

        const simulations = Array.from({ length: simulationCount }, () => {
            const { piece: upgradedPiece } = simulateUpgrade(piece);
            const upgradedStats = calculateGearStats(upgradedPiece);
            const potentialScore = calculatePriorityScore(upgradedStats, [], shipRole);
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

    return results.sort((a, b) => b.potentialScore - a.potentialScore).slice(0, count);
}
