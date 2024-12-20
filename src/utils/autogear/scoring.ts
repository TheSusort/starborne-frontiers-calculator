import { BaseStats } from '../../types/stats';
import { StatPriority } from '../../types/autogear';
import { GearSlotName, STAT_NORMALIZERS, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats } from '../statsCalculator';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';

// Defense reduction curve approximation based on the graph
export function calculateDamageReduction(defense: number): number {
    // Convert defense to thousands for easier calculation
    const x = defense / 1000;
    // Sigmoid-like function that approximates the curve
    return 87 * (1 - Math.exp(-0.15 * x)) / (1 + 0.1 * x);
}

export function calculateEffectiveHP(hp: number, defense: number): number {
    const damageReduction = calculateDamageReduction(defense);
    return hp * (100 / (100 - damageReduction));
}

function calculateDPS(stats: BaseStats): number {
    const critMultiplier = 1 + (stats.crit || 0) / 100 * ((stats.critDamage || 0) - 100) / 100;
    return (stats.attack || 0) * critMultiplier;
}

export function calculatePriorityScore(
    stats: BaseStats,
    priorities: StatPriority[],
    shipRole?: ShipTypeName
): number {
    // If a specific role is defined, use role-specific scoring
    if (shipRole) {
        switch (shipRole) {
            case 'Attacker':
                return calculateAttackerScore(stats);
            case 'Defender':
                return calculateDefenderScore(stats);
            case 'Debuffer':
                return calculateDebufferScore(stats);
            case 'Supporter':
                return calculateSupporterScore(stats);
            default:
                // Fall through to default scoring
                break;
        }
    }

    // Default scoring logic (unchanged)
    let totalScore = 0;
    priorities.forEach((priority, index) => {
        const statValue = stats[priority.stat] || 0;
        const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
        const normalizedValue = statValue / normalizer;
        const orderMultiplier = Math.pow(2, priorities.length - index - 1);

        if (priority.maxLimit) {
            const normalizedLimit = priority.maxLimit / normalizer;
            if (normalizedValue > normalizedLimit) {
                totalScore -= (normalizedValue - normalizedLimit) * priority.weight * orderMultiplier * 100;
                return;
            }

            let score = normalizedValue * priority.weight * orderMultiplier;
            const ratio = normalizedValue / normalizedLimit;
            if (ratio > 0.8) {
                score *= (1 - (ratio - 0.8));
            }
            totalScore += score;
        } else {
            totalScore += normalizedValue * priority.weight * orderMultiplier;
        }
    });

    return totalScore;
}

function calculateAttackerScore(stats: BaseStats): number {
    const dps = calculateDPS(stats);
    return dps;
}

function calculateDefenderScore(stats: BaseStats): number {
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    return effectiveHP;
}

function calculateDebufferScore(stats: BaseStats): number {
    const hacking = stats.hacking || 0;
    const hackingScore = hacking >= 270 ? 1000 : hacking / 270 * 1000;
    const dps = calculateDPS(stats);

    return hackingScore + (dps * 0.5); // DPS is secondary priority
}

function calculateSupporterScore(stats: BaseStats): number {
    const healModifier = stats.healModifier || 0;
    const baseHealing = (stats.hp || 0) * 0.15; // 15% of HP
    const critMultiplier = 1 + (stats.crit || 0) / 100 * ((stats.critDamage || 0) - 100) / 100;
    const totalHealing = baseHealing * critMultiplier * (1 + healModifier / 100);

    return totalHealing;
}

// Update calculateTotalScore to include shipRole
export function calculateTotalScore(
    ship: Ship,
    equipment: Partial<Record<GearSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName
): number {
    const totalStats = calculateTotalStats(
        ship.baseStats,
        equipment,
        getGearPiece,
        ship.refits,
        ship.implants,
        getEngineeringStatsForShipType(ship.type)
    );

    let score = calculatePriorityScore(totalStats, priorities, shipRole);

    // Add set bonus consideration
    const setCount: Record<string, number> = {};
    Object.values(equipment).forEach(gearId => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) return;
        setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
    });

    Object.values(setCount).forEach(count => {
        if (count >= 2) {
            score *= 1.15; // 15% bonus for completed sets
        }
    });

    return score;
}