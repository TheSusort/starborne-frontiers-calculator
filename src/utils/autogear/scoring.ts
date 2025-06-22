import { BaseStats } from '../../types/stats';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GearSlotName, STAT_NORMALIZERS, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats, clearGearStatsCache } from '../ship/statsCalculator';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';
import { ENEMY_ATTACK, ENEMY_COUNT, BASE_HEAL_PERCENT } from '../../constants/simulation';
import { performanceTracker } from './performanceTimer';

// Simple cache for gear combinations
const scoreCache = new Map<string, number>();
const CACHE_SIZE_LIMIT = 50000; // Increased cache size for better hit rates

// Pre-computed cache keys for common equipment combinations
const equipmentKeyCache = new Map<string, string>();

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

// Defense penetration lookup table with known values
const DEFENSE_PENETRATION_LOOKUP: Record<number, number> = {
    0: 74.21,
    7: 72.71,
    14: 71.04,
    20: 69.45,
    21: 69.17,
    27: 67.38,
    34: 65.04,
    41: 62.37,
};

// Default defense value for calculations
const DEFAULT_DEFENSE = 10000;

export function calculateDPS(stats: BaseStats): number {
    const attack = stats.attack || 0;
    const critMultiplier = calculateCritMultiplier(stats);
    const defensePenetration = stats.defensePenetration || 0;

    // Get damage reduction from lookup table or calculate it
    let damageReduction: number;
    if (DEFENSE_PENETRATION_LOOKUP[defensePenetration] !== undefined) {
        damageReduction = DEFENSE_PENETRATION_LOOKUP[defensePenetration];
    } else {
        // Fallback to full calculation for unknown values
        const effectiveDefense = DEFAULT_DEFENSE * (1 - defensePenetration / 100);
        damageReduction = calculateDamageReduction(effectiveDefense);
    }

    // Calculate final DPS with damage reduction
    return attack * critMultiplier * (1 - damageReduction / 100);
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
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[]
): number {
    let penalties = 0;

    // Check hard requirements first - if any hard requirement is not met, return 0
    for (const priority of priorities) {
        if (priority.hardRequirement) {
            const statValue = stats[priority.stat] || 0;

            if (priority.minLimit && statValue < priority.minLimit) {
                return 0; // Hard requirement not met
            }

            if (priority.maxLimit && statValue > priority.maxLimit) {
                return 0; // Hard requirement not met
            }
        }
    }

    // Calculate penalties based on min/max limits (soft requirements)
    for (const priority of priorities) {
        // Skip hard requirements as they were already checked above
        if (priority.hardRequirement) continue;

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
        switch (shipRole as ShipTypeName) {
            case 'ATTACKER':
                baseScore = calculateAttackerScore(stats, statBonuses);
                break;
            case 'DEFENDER':
                baseScore = calculateDefenderScore(stats, statBonuses);
                break;
            case 'DEFENDER_SECURITY':
                baseScore = calculateDefenderSecurityScore(stats, statBonuses);
                break;
            case 'DEBUFFER':
                baseScore = calculateDebufferScore(stats, statBonuses);
                break;
            case 'DEBUFFER_DEFENSIVE':
                baseScore = calculateDefensiveDebufferScore(stats, statBonuses);
                break;
            case 'DEBUFFER_BOMBER':
                baseScore = calculateBomberDebufferScore(stats, statBonuses);
                break;
            case 'SUPPORTER':
                baseScore = calculateHealerScore(stats, statBonuses);
                break;
            case 'SUPPORTER_BUFFER':
                baseScore = calculateBufferScore(stats, setCount, statBonuses);
                break;
            case 'SUPPORTER_OFFENSIVE':
                baseScore = calculateOffensiveSupporterScore(stats, setCount, statBonuses);
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

// Helper function to apply role stat bonuses
function applystatBonuses(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 0;

    return statBonuses.reduce((total, bonus) => {
        const statValue = stats[bonus.stat as keyof BaseStats] || 0;
        return total + statValue * (bonus.percentage / 100);
    }, 0);
}

function calculateAttackerScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseDPS = calculateDPS(stats);

    const bonusScore = applystatBonuses(stats, statBonuses);
    return baseDPS + bonusScore;
}

function calculateDefenderScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const damageReduction = calculateDamageReduction(stats.defence || 0);
    const totalEffectiveHP = (stats.hp || 0) * (100 / (100 - damageReduction));
    const bonusScore = applystatBonuses(stats, statBonuses);

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
    if (healingWithShieldPerRound >= damagePerRound) {
        return Number.MAX_SAFE_INTEGER;
    }

    const survivalRounds = totalEffectiveHP / (damagePerRound - healingWithShieldPerRound);
    return Math.max(survivalRounds * 1000 + bonusScore, 0);
}

function calculateDefenderSecurityScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseDefenderScore = calculateDefenderScore(stats, statBonuses);
    const security = stats.security || 0;

    return baseDefenderScore * security;
}

function calculateDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const dps = calculateDPS(stats);
    const bonusScore = applystatBonuses(stats, statBonuses);

    return hacking * dps + bonusScore;
}

function calculateDefensiveDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    const bonusScore = applystatBonuses(stats, statBonuses);
    return hacking * effectiveHP + bonusScore;
}

function calculateBomberDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const attack = stats.attack || 0;
    const bonusScore = applystatBonuses(stats, statBonuses);

    return hacking * attack + bonusScore;
}

function calculateHealerScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT; // 15% of HP

    // Use same crit calculation as DPS
    const critMultiplier = calculateCritMultiplier(stats);
    const bonusScore = applystatBonuses(stats, statBonuses);

    // Apply heal modifier after crit calculations
    const healModifier = stats.healModifier || 0;

    return baseHealing * critMultiplier * (1 + healModifier / 100) + bonusScore;
}

function calculateBufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    const bonusScore = applystatBonuses(stats, statBonuses);

    const speedScore = speed * 10; // Base weight for speed

    // Boost set scoring (4 pieces needed for set bonus)
    // Heavily reward having the full set
    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 30000; // Major bonus for complete set
    }

    // Add effective HP as a secondary consideration
    // Scale it down to not overshadow primary stats
    const ehpScore = Math.sqrt(effectiveHP) * 2;

    return speedScore + boostScore + ehpScore + bonusScore;
}

function calculateOffensiveSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const attack = Math.sqrt(stats.attack || 0) * 2;
    const bonusScore = applystatBonuses(stats, statBonuses);

    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 30000; // Major bonus for complete set
    }

    return speed * 10 + attack + boostScore + bonusScore;
}

// Update calculateTotalScore to include shipRole and setPriorities
export function calculateTotalScore(
    ship: Ship,
    equipment: Partial<Record<GearSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[]
): number {
    performanceTracker.startTimer('CalculateTotalScore');

    // Create cache key from equipment configuration
    performanceTracker.startTimer('CreateCacheKey');

    // Use cached equipment key if available
    let equipmentKey = equipmentKeyCache.get(JSON.stringify(equipment));
    if (!equipmentKey) {
        equipmentKey = Object.entries(equipment)
            .filter(([_, gearId]) => gearId !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([slot, gearId]) => `${slot}:${gearId}`)
            .join('|');

        // Cache the equipment key for reuse
        if (equipmentKeyCache.size < 10000) {
            // Limit equipment key cache size
            equipmentKeyCache.set(JSON.stringify(equipment), equipmentKey);
        }
    }

    // Simplified cache key - only include essential parameters
    const cacheKey = `${ship.id}|${equipmentKey}|${shipRole || 'none'}`;
    performanceTracker.endTimer('CreateCacheKey');

    // Check cache first
    performanceTracker.startTimer('CheckCache');
    if (scoreCache.has(cacheKey)) {
        performanceTracker.endTimer('CheckCache');
        performanceTracker.endTimer('CalculateTotalScore');
        return scoreCache.get(cacheKey)!;
    }
    performanceTracker.endTimer('CheckCache');

    performanceTracker.startTimer('CalculateTotalStats');
    const totalStats = calculateTotalStats(
        ship.baseStats,
        equipment,
        getGearPiece,
        ship.refits,
        ship.implants,
        getEngineeringStatsForShipType(ship.type)
    );
    performanceTracker.endTimer('CalculateTotalStats');

    // Add set bonus consideration
    performanceTracker.startTimer('CalculateSetCount');
    const setCount: Record<string, number> = {};
    Object.values(equipment).forEach((gearId) => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) return;
        setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
    });
    performanceTracker.endTimer('CalculateSetCount');

    performanceTracker.startTimer('CalculatePriorityScore');
    const score = calculatePriorityScore(
        totalStats.final,
        priorities,
        shipRole,
        setCount,
        setPriorities,
        statBonuses
    );
    performanceTracker.endTimer('CalculatePriorityScore');

    // Cache the result
    performanceTracker.startTimer('CacheResult');
    if (scoreCache.size >= CACHE_SIZE_LIMIT) {
        // Clear cache if it gets too large
        scoreCache.clear();
        equipmentKeyCache.clear(); // Also clear equipment key cache
    }
    scoreCache.set(cacheKey, score);
    performanceTracker.endTimer('CacheResult');

    performanceTracker.endTimer('CalculateTotalScore');
    return score;
}

// Function to clear the cache (useful for testing or when memory is a concern)
export function clearScoreCache(): void {
    scoreCache.clear();
    equipmentKeyCache.clear();
    clearGearStatsCache();
}
