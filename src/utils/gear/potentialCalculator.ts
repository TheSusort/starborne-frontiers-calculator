import { GearPiece } from '../../types/gear';
import { Stat, StatName, StatType } from '../../types/stats';
import { STATS } from '../../constants';
import { calculateMainStatValue } from './mainStatValueFetcher';
import { calculatePriorityScore } from '../autogear/scoring';
import { ShipTypeName } from '../../constants';
import { SUBSTAT_RANGES } from '../../constants/statValues';
import { BaseStats } from '../../types/stats';
import { calculateTotalStats } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';

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
    currentStats: Stat[],
    mainStat: Stat
): { name: StatName; types: StatType[] }[] {
    const availableStats: { name: StatName; types: StatType[] }[] = [];

    Object.entries(STATS).forEach(([statName, statConfig]) => {
        const name = statName as StatName;
        if (name === mainStat.name) return;

        const availableTypes = statConfig.allowedTypes.filter(
            (type) => !currentStats.some((s) => s.name === name && s.type === type)
        );

        if (availableTypes.length > 0) {
            availableStats.push({ name, types: availableTypes });
        }
    });

    return availableStats;
}

function getSubstatIncrease(stat: Stat, rarity: string): number {
    const range = SUBSTAT_RANGES[stat.name]?.[stat.type];
    if (!range) return 0;

    const { min, max } = range;
    switch (rarity) {
        case 'rare':
            return min;
        case 'epic':
            return Math.floor((min + max) / 2);
        case 'legendary':
            return max;
        default:
            return 0;
    }
}

function simulateUpgrade(piece: GearPiece, targetLevel: number = 16): GearPiece {
    if (piece.level >= targetLevel) return piece;

    const config = UPGRADE_LEVELS[piece.rarity as keyof typeof UPGRADE_LEVELS];
    if (!config) return piece;

    const upgradedPiece = { ...piece };

    // Calculate main stat at target level
    const newMainStatValue = calculateMainStatValue(
        piece.mainStat.name,
        piece.mainStat.type,
        piece.stars,
        targetLevel
    );
    upgradedPiece.mainStat = { ...piece.mainStat, value: newMainStatValue };

    // Simulate substat upgrades
    const newSubStats = [...piece.subStats];
    const remainingLevels = [];
    for (let level = piece.level + 4; level <= targetLevel; level += 4) {
        remainingLevels.push(level);
    }

    remainingLevels.forEach((level) => {
        if (config.additions.includes(level)) {
            const availableStats = getAvailableStats(newSubStats, piece.mainStat);
            if (availableStats.length > 0) {
                const randomStat =
                    availableStats[Math.floor(Math.random() * availableStats.length)];
                const randomType =
                    randomStat.types[Math.floor(Math.random() * randomStat.types.length)];

                if (SUBSTAT_RANGES[randomStat.name]?.[randomType]) {
                    const randomValue = Math.floor(
                        SUBSTAT_RANGES[randomStat.name][randomType].min +
                            Math.random() *
                                (SUBSTAT_RANGES[randomStat.name][randomType].max -
                                    SUBSTAT_RANGES[randomStat.name][randomType].min)
                    );
                    newSubStats.push({
                        name: randomStat.name,
                        type: randomType,
                        value: randomValue,
                    } as Stat);
                }
            }
        } else if (config.increases.includes(level)) {
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
    });

    upgradedPiece.subStats = newSubStats;
    upgradedPiece.level = targetLevel;
    return upgradedPiece;
}

function calculateGearStats(piece: GearPiece): BaseStats {
    const breakdown = calculateTotalStats(
        // Empty base stats
        {
            hp: 20000,
            attack: 5000,
            defence: 4000,
            hacking: 150,
            security: 50,
            speed: 80,
            crit: 50,
            critDamage: 0,
            healModifier: 0,
        },
        // Single piece of gear
        { [piece.slot]: piece.id },
        // Gear piece getter
        (id) => (id === piece.id ? piece : undefined),
        // No refits, implants, or engineering
        [],
        [],
        undefined
    );

    // Add set bonus stats if the piece has a set
    if (piece.setBonus && GEAR_SETS[piece.setBonus]) {
        const setBonus = GEAR_SETS[piece.setBonus];
        if (setBonus.stats) {
            setBonus.stats.forEach((stat) => {
                const currentValue = breakdown.final[stat.name] || 0;
                if (stat.type === 'percentage') {
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
    count: number = 6
): PotentialResult[] {
    const eligiblePieces = inventory.filter(
        (piece) => piece.level < 16 && ['rare', 'epic', 'legendary'].includes(piece.rarity)
    );

    const results: PotentialResult[] = eligiblePieces.map((piece) => {
        const currentStats = calculateGearStats(piece);
        const currentScore = calculatePriorityScore(currentStats, [], shipRole);

        const simulations = Array.from({ length: 100 }, () => {
            const upgradedPiece = simulateUpgrade(piece);
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
