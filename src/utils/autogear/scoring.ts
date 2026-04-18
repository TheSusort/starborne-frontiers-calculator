import { EngineeringStat } from '../../types/stats';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GearSlotName, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats, clearGearStatsCache } from '../ship/statsCalculator';
import { GearPiece } from '../../types/gear';
import { RarityName } from '../../constants/rarities';
import { performanceTracker } from './performanceTimer';
import { applyArenaModifiers } from './arenaModifiers';
import {
    calculatePriorityScore,
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateHealingPerHit,
    calculateCritMultiplier,
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
} from './priorityScore';

// Re-export calculatePriorityScore so existing imports from this module continue to work
export {
    calculatePriorityScore,
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateHealingPerHit,
    calculateCritMultiplier,
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
};

// Simple cache for gear combinations
const scoreCache = new Map<string, number>();
const CACHE_SIZE_LIMIT = 50000; // Increased cache size for better hit rates

// Pre-computed cache keys for common equipment combinations
// Using WeakMap would be ideal but we need string keys for the cache
// Instead, we'll use a more efficient key generation that avoids JSON.stringify
const equipmentKeyCache = new Map<string, string>();

// Cache for implants key per ship (implants don't change during gear optimization)
const implantsKeyCache = new Map<string, string>();

// Arcane Siege multiplier values by rarity
const ARCANE_SIEGE_MULTIPLIERS: Record<RarityName, number> = {
    common: 3,
    uncommon: 5,
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
    const rarity = arcaneSiegeImplant.rarity;
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
function calculateArcaneSiegeMultiplier(
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
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null
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

    // Include implants and stat bonuses in cache key to properly differentiate configurations
    const bonusesKey = statBonuses?.length
        ? statBonuses.map((b) => `${b.stat}:${b.percentage}:${b.mode || 'a'}`).join(',')
        : 'none';
    const arenaKey = arenaModifiers
        ? Object.entries(arenaModifiers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([s, v]) => `${s}:${v}`)
              .join(',')
        : 'none';
    const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}`;
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

    // Apply arena modifiers to stats for scoring (does not affect displayed stats)
    const statsForScoring =
        arenaModifiers && Object.keys(arenaModifiers).length > 0
            ? applyArenaModifiers(totalStats.final, arenaModifiers)
            : totalStats.final;

    performanceTracker.startTimer('CalculatePriorityScore');
    const score = calculatePriorityScore(
        statsForScoring,
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
    clearGearStatsCache();
}
