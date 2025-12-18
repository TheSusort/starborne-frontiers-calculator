import { BaseStats } from '../../types/stats';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GearSlotName, STAT_NORMALIZERS, ShipTypeName, GEAR_SETS } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats, clearGearStatsCache } from '../ship/statsCalculator';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';
import { ENEMY_ATTACK, ENEMY_COUNT, BASE_HEAL_PERCENT } from '../../constants/simulation';
import { performanceTracker } from './performanceTimer';
import { RarityName } from '../../constants/rarities';

// Simple cache for gear combinations
const scoreCache = new Map<string, number>();
const CACHE_SIZE_LIMIT = 50000; // Increased cache size for better hit rates

// Pre-computed cache keys for common equipment combinations
// Using WeakMap would be ideal but we need string keys for the cache
// Instead, we'll use a more efficient key generation that avoids JSON.stringify
const equipmentKeyCache = new Map<string, string>();

// Cache for implants key per ship (implants don't change during gear optimization)
const implantsKeyCache = new Map<string, string>();

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

// Defense penetration lookup table with known values at 15k defense
const DEFENSE_PENETRATION_LOOKUP: Record<number, number> = {
    0: 81.45,
    7: 80.31,
    14: 79,
    20: 77.72,
    21: 77.49,
    27: 76,
    34: 74,
    41: 71.66,
};

// Default defense value for calculations
const DEFAULT_DEFENSE = 15000;

// Arcane Siege multiplier values by rarity
const ARCANE_SIEGE_MULTIPLIERS: Record<RarityName, number> = {
    common: 3,
    uncommon: 6,
    rare: 10,
    epic: 15,
    legendary: 20,
};

// Cache for Arcane Siege implant info per ship (implants don't change during gear optimization)
const arcaneSiegeCache = new Map<string, number | null>(); // ship.id -> multiplier or null if no implant

/**
 * Get the Arcane Siege multiplier for a ship (cached, since implants don't change).
 * Returns the multiplier percentage (0-20) if ship has ARCANE_SIEGE implant, otherwise null.
 * This is the base multiplier - still need to check shield count separately.
 */
function getArcaneSiegeBaseMultiplier(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined
): number | null {
    const cacheKey = ship.id;

    if (arcaneSiegeCache.has(cacheKey)) {
        return arcaneSiegeCache.get(cacheKey)!;
    }

    // Check if ship has ARCANE_SIEGE implant
    let arcaneSiegeImplant: GearPiece | undefined;
    const implants = ship.implants || {};

    for (const implantId of Object.values(implants)) {
        if (!implantId) continue;
        const implant = getGearPiece(implantId);
        if (implant?.setBonus === 'ARCANE_SIEGE') {
            arcaneSiegeImplant = implant;
            break; // Found it, no need to check more
        }
    }

    if (!arcaneSiegeImplant) {
        arcaneSiegeCache.set(cacheKey, null);
        return null;
    }

    // Return the multiplier based on implant rarity
    const rarity = arcaneSiegeImplant.rarity as RarityName;
    const multiplier = ARCANE_SIEGE_MULTIPLIERS[rarity] || 0;
    arcaneSiegeCache.set(cacheKey, multiplier);
    return multiplier;
}

/**
 * Calculate Arcane Siege damage multiplier if conditions are met.
 * Returns the multiplier percentage (0-20) if:
 * 1. Ship has ARCANE_SIEGE implant (cached check)
 * 2. Ship has 2+ SHIELD gear pieces (uses pre-calculated setCount)
 * Otherwise returns 0.
 *
 * Optimized to reuse setCount and cache implant lookup.
 */
export function calculateArcaneSiegeMultiplier(
    ship: Ship,
    setCount: Record<string, number>,
    getGearPiece: (id: string) => GearPiece | undefined
): number {
    // Early exit: check cached implant multiplier
    const baseMultiplier = getArcaneSiegeBaseMultiplier(ship, getGearPiece);
    if (baseMultiplier === null) {
        return 0;
    }

    // Check if ship has 2+ SHIELD gear pieces (reuse setCount)
    const shieldCount = setCount['SHIELD'] || 0;
    if (shieldCount < 2) {
        return 0;
    }

    return baseMultiplier;
}

export function calculateDPS(stats: BaseStats, arcaneSiegeMultiplier: number = 0): number {
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

    // Calculate base DPS with damage reduction
    const baseDPS = attack * critMultiplier * (1 - damageReduction / 100);

    // Apply Arcane Siege multiplier if applicable (multiplier is a percentage, e.g., 20 for 20%)
    if (arcaneSiegeMultiplier > 0) {
        return baseDPS * (1 + arcaneSiegeMultiplier / 100);
    }

    return baseDPS;
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
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arcaneSiegeMultiplier: number = 0
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

    // Penalize incomplete sets when tryToCompleteSets is enabled
    if (tryToCompleteSets && setCount) {
        for (const [setName, count] of Object.entries(setCount)) {
            if (count > 0) {
                const minPieces = GEAR_SETS[setName]?.minPieces || 2;
                if (count < minPieces) {
                    // Calculate penalty as percentage below minimum pieces needed for set bonus
                    const diff = (minPieces - count) / minPieces;
                    penalties += diff * 150; // Moderate penalty for incomplete sets
                }
            }
        }
    }

    // Get base score from role-specific calculation
    let baseScore = 0;
    if (shipRole) {
        switch (shipRole as ShipTypeName) {
            case 'ATTACKER':
                baseScore = calculateAttackerScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEFENDER':
                baseScore = calculateDefenderScore(stats, statBonuses);
                break;
            case 'DEFENDER_SECURITY':
                baseScore = calculateDefenderSecurityScore(stats, statBonuses);
                break;
            case 'DEBUFFER':
                baseScore = calculateDebufferScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEBUFFER_DEFENSIVE':
                baseScore = calculateDefensiveDebufferScore(stats, statBonuses);
                break;
            case 'DEBUFFER_BOMBER':
                baseScore = calculateBomberDebufferScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEBUFFER_CORROSION':
                baseScore = calculateCorrosionDebufferScore(stats, setCount, statBonuses);
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
            case 'SUPPORTER_SHIELD':
                baseScore = calculateShieldSupporterScore(stats, setCount, statBonuses);
                break;
        }
    } else {
        // Default scoring logic for manual mode
        baseScore = calculateDefaultScore(stats, priorities);
    }

    // Apply penalties as percentage reduction of base score
    return Math.max(0, baseScore * (1 - penalties / 100));
}

// Cache for pre-calculated order multipliers to avoid repeated Math.pow calls
const orderMultiplierCache = new Map<number, number[]>();

/**
 * Get pre-calculated order multipliers for a given priorities length.
 * Avoids repeated Math.pow calls in calculateDefaultScore.
 */
function getOrderMultipliers(length: number): number[] {
    let multipliers = orderMultiplierCache.get(length);
    if (!multipliers) {
        multipliers = Array.from({ length }, (_, index) => Math.pow(2, length - index - 1));
        orderMultiplierCache.set(length, multipliers);
    }
    return multipliers;
}

// Helper function for default scoring mode
function calculateDefaultScore(stats: BaseStats, priorities: StatPriority[]): number {
    let totalScore = 0;
    const orderMultipliers = getOrderMultipliers(priorities.length);
    priorities.forEach((priority, index) => {
        const statValue = stats[priority.stat] || 0;
        const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
        const normalizedValue = statValue / normalizer;
        const orderMultiplier = orderMultipliers[index];
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

function calculateAttackerScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const baseDPS = calculateDPS(stats, arcaneSiegeMultiplier);

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

function calculateDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    const dps = calculateDPS(stats, arcaneSiegeMultiplier);
    const bonusScore = applystatBonuses(stats, statBonuses);

    return hacking * dps + bonusScore;
}

function calculateDefensiveDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    const bonusScore = applystatBonuses(stats, statBonuses);
    return hacking * effectiveHP + bonusScore;
}

function calculateBomberDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    // For bomber debuffers, Arcane Siege affects attack-based damage
    const attack = stats.attack || 0;
    const attackWithMultiplier =
        arcaneSiegeMultiplier > 0 ? attack * (1 + arcaneSiegeMultiplier / 100) : attack;
    const bonusScore = applystatBonuses(stats, statBonuses);

    return hacking * attackWithMultiplier + bonusScore;
}

function calculateCorrosionDebufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hacking = stats.hacking || 0;
    const decimation = setCount?.DECIMATION || 0;
    const bonusScore = applystatBonuses(stats, statBonuses);

    // Hacking is the primary stat (0-500 range) that inflicts the DoT
    // Decimation sets provide 10% damage increase each (max 3 sets = 30% total)
    // Formula: base_hacking * (1 + decimation_multiplier) + bonus_score
    const decimationMultiplier = decimation * 0.1; // 10% per piece
    const totalDamage = hacking * (1 + decimationMultiplier);

    return totalDamage + bonusScore;
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
        boostScore = 45000; // Major bonus for complete set
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
        boostScore = 45000; // Major bonus for complete set
    }

    return speed * 10 + attack + boostScore + bonusScore;
}

function calculateShieldSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hp = stats.hp || 0;
    const bonusScore = applystatBonuses(stats, statBonuses);

    return hp + bonusScore;
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
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean
): number {
    performanceTracker.startTimer('CalculateTotalScore');

    // Create cache key from equipment configuration
    performanceTracker.startTimer('CreateCacheKey');

    // Generate equipment key more efficiently (avoid JSON.stringify for lookup)
    // Create a deterministic key by sorting entries
    const equipmentEntries = Object.entries(equipment)
        .filter(([_, gearId]) => gearId !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));

    // Create a fast string key for lookup (without JSON.stringify)
    const equipmentKeyRaw = equipmentEntries.map(([slot, gearId]) => `${slot}:${gearId}`).join('|');

    // Use cached equipment key if available
    let equipmentKey = equipmentKeyCache.get(equipmentKeyRaw);
    if (!equipmentKey) {
        equipmentKey = equipmentKeyRaw;
        // Cache the equipment key for reuse
        if (equipmentKeyCache.size < 10000) {
            equipmentKeyCache.set(equipmentKeyRaw, equipmentKey);
        }
    }

    // Cache implants key per ship (implants don't change during gear optimization)
    const shipImplantsKey = `${ship.id}_implants`;
    let implantsKey = implantsKeyCache.get(shipImplantsKey);
    if (!implantsKey) {
        implantsKey = ship.implants
            ? Object.entries(ship.implants)
                  .filter(([_, implantId]) => implantId !== undefined)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([slot, implantId]) => `${slot}:${implantId}`)
                  .join('|')
            : 'none';
        implantsKeyCache.set(shipImplantsKey, implantsKey);
    }

    // Include implants in cache key to properly differentiate configurations
    const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}`;
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
        getEngineeringStatsForShipType(ship.type),
        ship.id
    );
    performanceTracker.endTimer('CalculateTotalStats');

    // Add set bonus consideration
    // Optimize: reuse equipmentEntries we already created for cache key
    performanceTracker.startTimer('CalculateSetCount');
    const setCount: Record<string, number> = {};
    // Use equipmentEntries from cache key generation to avoid re-iterating
    for (const [_, gearId] of equipmentEntries) {
        if (!gearId) continue;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) continue;
        setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
    }
    performanceTracker.endTimer('CalculateSetCount');

    // Calculate Arcane Siege multiplier if applicable (reuses setCount, caches implant lookup)
    performanceTracker.startTimer('CalculateArcaneSiege');
    const arcaneSiegeMultiplier = calculateArcaneSiegeMultiplier(ship, setCount, getGearPiece);
    performanceTracker.endTimer('CalculateArcaneSiege');

    performanceTracker.startTimer('CalculatePriorityScore');
    const score = calculatePriorityScore(
        totalStats.final,
        priorities,
        shipRole,
        setCount,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arcaneSiegeMultiplier
    );
    performanceTracker.endTimer('CalculatePriorityScore');

    // Cache the result
    performanceTracker.startTimer('CacheResult');
    if (scoreCache.size >= CACHE_SIZE_LIMIT) {
        // Clear cache if it gets too large
        scoreCache.clear();
        equipmentKeyCache.clear();
        // Note: We keep implantsKeyCache and arcaneSiegeCache as they're per-ship and small
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
    implantsKeyCache.clear();
    arcaneSiegeCache.clear();
    orderMultiplierCache.clear();
    clearGearStatsCache();
}
