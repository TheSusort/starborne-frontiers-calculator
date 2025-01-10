import { BaseStats } from '../../types/stats';
import { StatPriority } from '../../types/autogear';
import { GearSlotName, STAT_NORMALIZERS, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats } from '../statsCalculator';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';

// Defense reduction curve approximation based on the graph
export function calculateDamageReduction(defense: number): number {
    const a = 88.3505;
    const b = 4.5552;
    const c = 1.3292;

    return a * Math.exp(-Math.pow((b - Math.log10(defense)) / c, 2));
}

export function calculateEffectiveHP(hp: number, defense: number): number {
    const damageReduction = calculateDamageReduction(defense);
    return hp * (100 / (100 - damageReduction));
}

function calculateDPS(stats: BaseStats): number {
    const crit = stats.crit >= 100 ? 1 : stats.crit / 100;
    const critMultiplier = 1 + crit * ((stats.critDamage || 0) / 100);
    return (stats.attack || 0) * critMultiplier;
}

export function calculatePriorityScore(
    stats: BaseStats,
    priorities: StatPriority[],
    shipRole?: ShipTypeName,
    setCount?: Record<string, number>
): number {
    // Check all minimum requirements first
    for (const priority of priorities) {
        if (priority.minLimit) {
            const statValue = stats[priority.stat] || 0;
            const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
            const normalizedValue = statValue / normalizer;
            const normalizedMin = priority.minLimit / normalizer;

            if (normalizedValue < normalizedMin) {
                // Heavy penalty for not meeting minimum requirements
                return (normalizedValue / normalizedMin) * 100;
            }
        }
    }

    // If all minimum requirements are met, proceed with role-specific scoring
    if (shipRole) {
        switch (shipRole) {
            case 'Attacker':
                return calculateAttackerScore(stats);
            case 'Defender':
                return calculateDefenderScore(stats);
            case 'Debuffer':
                return calculateDebufferScore(stats);
            case 'Supporter':
                return calculateHealerScore(stats);
            case 'Supporter(Buffer)':
                return calculateBufferScore(stats, setCount);
            default:
                break;
        }
    }

    // Default scoring logic for manual mode or after role-specific scoring
    let totalScore = 0;
    priorities.forEach((priority, index) => {
        const statValue = stats[priority.stat] || 0;
        const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
        const normalizedValue = statValue / normalizer;
        const orderMultiplier = Math.pow(2, priorities.length - index - 1);

        if (priority.maxLimit) {
            const normalizedLimit = priority.maxLimit / normalizer;
            if (normalizedValue > normalizedLimit) {
                totalScore -=
                    (normalizedValue - normalizedLimit) * priority.weight * orderMultiplier * 100;
                return;
            }

            let score = normalizedValue * priority.weight * orderMultiplier;
            const ratio = normalizedValue / normalizedLimit;
            if (ratio > 0.8) {
                score *= 1 - (ratio - 0.8);
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
    const dps = calculateDPS(stats);

    // Heavily penalize builds below 270 hacking
    if (hacking < 270) {
        return (hacking / 270) * 100; // Very low score if below minimum
    }

    // Base score starts at 1000 for meeting minimum hacking and speed
    let score = 1000;

    // Additional score for hacking above minimum (diminishing returns)
    if (hacking > 270) {
        score += Math.sqrt(hacking - 270) * 10;
    }

    // Add DPS contribution with higher weight
    score += dps;

    return score;
}

function calculateHealerScore(stats: BaseStats): number {
    const baseHealing = (stats.hp || 0) * 0.15; // 15% of HP

    // Use same crit calculation as DPS
    const crit = stats.crit >= 100 ? 1 : (stats.crit || 0) / 100;
    const critMultiplier = 1 + crit * ((stats.critDamage || 0) / 100);

    // Apply heal modifier after crit calculations
    const healModifier = stats.healModifier || 0;
    const totalHealing = baseHealing * critMultiplier * (1 + healModifier / 100);

    return totalHealing;
}

function calculateBufferScore(stats: BaseStats, setCount?: Record<string, number>): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);

    // Calculate speed score with diminishing returns after 180
    let speedScore;
    if (speed <= 180) {
        speedScore = speed * 10; // Base weight for speed
    } else {
        speedScore = 180 * 10 + Math.sqrt(speed - 180) * 20; // Diminishing returns
    }

    // Boost set scoring (4 pieces needed for set bonus)
    // Heavily reward having the full set
    let boostScore = 0;
    if (boostCount >= 4) {
        boostScore = 3000; // Major bonus for complete set
    }

    // Add effective HP as a secondary consideration
    // Scale it down to not overshadow primary stats
    const ehpScore = Math.sqrt(effectiveHP) * 2;

    return speedScore + boostScore + ehpScore;
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

    // Add set bonus consideration
    const setCount: Record<string, number> = {};
    Object.values(equipment).forEach((gearId) => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) return;
        setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
    });

    const score = calculatePriorityScore(totalStats.final, priorities, shipRole, setCount);

    return score;
}
