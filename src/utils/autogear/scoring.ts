import { BaseStats } from '../../types/stats';
import { StatPriority, SetPriority } from '../../types/autogear';
import { GearSlotName, STAT_NORMALIZERS, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats } from '../ship/statsCalculator';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';
import { ENEMY_ATTACK, ENEMY_COUNT, BASE_HEAL_PERCENT } from '../../constants/simulation';
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

export function calculateDPS(stats: BaseStats): number {
    return (stats.attack || 0) * calculateCritMultiplier(stats);
}

export function calculateHealingPerHit(stats: BaseStats): number {
    return (stats.hp || 0) * ((stats.hpRegen || 0) / 100) * calculateCritMultiplier(stats);
}

export function calculateCritMultiplier(stats: BaseStats): number {
    const crit = stats.crit >= 100 ? 1 : stats.crit / 100;
    return 1 + (crit * (stats.critDamage || 0)) / 100;
}

export function calculatePriorityScore(
    stats: BaseStats,
    priorities: StatPriority[],
    shipRole?: ShipTypeName,
    setCount?: Record<string, number>,
    setPriorities?: SetPriority[]
): number {
    let penalties = 0;

    // Calculate penalties based on min/max limits
    for (const priority of priorities) {
        const statValue = stats[priority.stat] || 0;

        if (priority.minLimit) {
            if (statValue < priority.minLimit) {
                // Calculate penalty as percentage below minimum
                const diff = (priority.minLimit - statValue) / priority.minLimit;
                penalties += diff * 100;
            }
        }

        if (priority.maxLimit) {
            if (statValue > priority.maxLimit) {
                // Calculate penalty as the percentage above maximum
                const diff = (statValue - priority.maxLimit) / priority.maxLimit;
                penalties += diff * 100;
            }
        }
    }

    // Calculate set requirement penalties
    if (setPriorities && setPriorities.length > 0 && setCount) {
        for (const setPriority of setPriorities) {
            const currentCount = setCount[setPriority.setName] || 0;
            if (currentCount < setPriority.count) {
                // Calculate penalty as percentage below required count
                // Multiply by 2 to make set requirements more important
                const diff = (setPriority.count - currentCount) / setPriority.count;
                penalties += diff * 200;
            }
        }
    }

    // Get base score from role-specific calculation
    let baseScore = 0;
    if (shipRole) {
        switch (shipRole) {
            case 'Attacker':
                baseScore = calculateAttackerScore(stats);
                break;
            case 'Defender':
                baseScore = calculateDefenderScore(stats);
                break;
            case 'Debuffer':
                baseScore = calculateDebufferScore(stats);
                break;
            case 'Supporter':
                baseScore = calculateHealerScore(stats);
                break;
            case 'Supporter(Buffer)':
                baseScore = calculateBufferScore(stats, setCount);
                break;
        }
    } else {
        // Default scoring logic for manual mode
        baseScore = calculateDefaultScore(stats, priorities);
    }

    // Apply penalties as percentage reduction of base score
    return Math.max(0, baseScore * (1 - penalties / 100));
}

// Helper function for default scoring mode
function calculateDefaultScore(stats: BaseStats, priorities: StatPriority[]): number {
    let totalScore = 0;
    priorities.forEach((priority, index) => {
        const statValue = stats[priority.stat] || 0;
        const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
        const normalizedValue = statValue / normalizer;
        const orderMultiplier = Math.pow(2, priorities.length - index - 1);
        totalScore += normalizedValue * (priority.weight || 1) * orderMultiplier;
    });
    return totalScore;
}

function calculateAttackerScore(stats: BaseStats): number {
    return calculateDPS(stats);
}

function calculateDefenderScore(stats: BaseStats): number {
    const damageReduction = calculateDamageReduction(stats.defence || 0);
    const totalEffectiveHP = (stats.hp || 0) * (100 / (100 - damageReduction));
    // Calculate incoming damage per round
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;

    // Calculate healing and shield per round
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;

    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;

    // Calculate survival rounds
    // If healing >= damage, technically infinite survival
    if (healingWithShieldPerRound >= damagePerRound) {
        return Number.MAX_SAFE_INTEGER;
    }

    // Otherwise, calculate rounds until death
    // totalEffectiveHP / (damagePerRound - healingWithShieldPerRound)
    const survivalRounds = totalEffectiveHP / (damagePerRound - healingWithShieldPerRound);

    return Math.max(survivalRounds * 1000, 0); // Multiply by 1000 to make the score more meaningful
}

function calculateDebufferScore(stats: BaseStats): number {
    const hacking = stats.hacking || 0;
    const dps = calculateDPS(stats);

    return dps * hacking;
}

function calculateHealerScore(stats: BaseStats): number {
    const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT; // 15% of HP

    // Use same crit calculation as DPS
    const critMultiplier = calculateCritMultiplier(stats);

    // Apply heal modifier after crit calculations
    const healModifier = stats.healModifier || 0;

    return baseHealing * critMultiplier * (1 + healModifier / 100);
}

function calculateBufferScore(stats: BaseStats, setCount?: Record<string, number>): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);

    // Calculate speed score with diminishing returns after 180
    const speedScore = speed * 10; // Base weight for speed

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

// Update calculateTotalScore to include shipRole and setPriorities
export function calculateTotalScore(
    ship: Ship,
    equipment: Partial<Record<GearSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[]
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

    const score = calculatePriorityScore(
        totalStats.final,
        priorities,
        shipRole,
        setCount,
        setPriorities
    );

    return score;
}
