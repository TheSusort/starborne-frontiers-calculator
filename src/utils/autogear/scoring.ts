import { EngineeringStat } from '../../types/stats';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import type { BasisTerm, FleetBuff, CustomFormula, RoleBasis } from '../../types/autogear';
import { EquipmentSlotName, ShipTypeName } from '../../constants';
import { Ship } from '../../types/ship';
import { calculateTotalStats, clearGearStatsCache } from '../ship/statsCalculator';
import { GearPiece } from '../../types/gear';
import { RarityName } from '../../constants/rarities';
import { performanceTracker } from './performanceTimer';
import { applyArenaModifiers } from './arenaModifiers';
import { applyFleetBuffs } from './fleetBuffs';
import {
    calculatePriorityScore,
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateHealingPerHit,
    calculateCritMultiplier,
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
    resolveLimitStatValue,
    calculateRoleScore,
    previewStatBonus,
} from './priorityScore';
import { sanitizeRoleBasis } from './customFormula';

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
    resolveLimitStatValue,
    calculateRoleScore,
    previewStatBonus,
};

// Exported for testing only.
export function evictOldestIfFull<K, V>(
    cache: Map<K, V>,
    limit: number,
    onEvict?: (key: K) => void
): void {
    if (cache.size < limit) return;
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
        cache.delete(oldestKey);
        onEvict?.(oldestKey);
    }
}

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

/**
 * A formula row's `basis` as a cache-key fragment. A basis is a sum, so term order is not
 * significant — sorted here from a copy so two bases differing only in authored order collapse
 * to one key. An absent or empty basis contributes '', so a basis-free row's key is unchanged
 * from before `basis` existed.
 */
function basisKeyPart(basis: BasisTerm[] | undefined): string {
    if (!basis || basis.length === 0) return '';
    return (
        ';' +
        basis
            .map((t) => `${t.stat}:${t.weight}`)
            .sort()
            .join(',')
    );
}

/**
 * A `roleBasis` as a cache-key fragment, order-independent in its terms and read from a copy
 * (`.map` before `.sort`) exactly as `basisKeyPart` is for a formula row's `basis`. `produces` is
 * part of the key too — two bases with identical terms but different `produces` apply to
 * different roles (`roleHostsBasis`) and must not collide. An absent or unsanitisable basis
 * contributes '', so a roleBasis-free call keeps the pre-existing key byte-for-byte.
 *
 * Runs `roleBasis` through `sanitizeRoleBasis` first: a saved config is untyped JSON reaching
 * this from localStorage or Supabase JSONB (Security rule 5), so a missing/non-array `terms` or
 * a non-finite weight must key as "no basis" here rather than throw on `.terms.length`.
 *
 * Exported so `fastScore`'s own local cache key can encode a `roleBasis` the same way, rather
 * than a second encoder drifting from this one.
 */
export function roleBasisKeyPart(roleBasis: RoleBasis | undefined): string {
    const sanitized = sanitizeRoleBasis(roleBasis);
    if (!sanitized) return '';
    return (
        ';' +
        sanitized.produces +
        ':' +
        sanitized.terms
            .map((t) => `${t.stat}:${t.weight}`)
            .sort()
            .join(',')
    );
}

// Update calculateTotalScore to include shipRole and setPriorities
export function calculateTotalScore(
    ship: Ship,
    // Widened past "real gear only": read only via Object.entries/Object.values, and
    // `SetFirstStrategy` passes a not-yet-split gear+implant working set through this param.
    equipment: Partial<Record<EquipmentSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null,
    fleetBuffs?: FleetBuff[],
    customFormula?: CustomFormula,
    roleBasis?: RoleBasis
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
    const fleetBuffsKey = fleetBuffs?.length
        ? fleetBuffs.map((b) => `${b.stat}:${b.percentage}`).join(',')
        : '';
    const formulaKey = customFormula?.rows.length
        ? customFormula.rows
              .map(
                  (r) =>
                      `${r.stat}:${r.kind}:${r.direction}:${r.importance ?? 1}:${r.percentage ?? 100}${basisKeyPart(r.basis)}`
              )
              .join(',')
        : 'none';
    // Appended directly (no `|` separator) so an absent `roleBasis` — which contributes '' —
    // leaves the key byte-for-byte identical to before this parameter existed.
    const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}|${fleetBuffsKey}|${formulaKey}${roleBasisKeyPart(roleBasis)}`;
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

    // Build implantSetCount separately — keeps setCount gear-only for the orphan penalty loop
    const implantSetCount: Record<string, number> = {};
    if (ship.implants) {
        for (const gearId of Object.values(ship.implants)) {
            if (!gearId) continue;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) continue;
            implantSetCount[gear.setBonus] = (implantSetCount[gear.setBonus] || 0) + 1;
        }
    }

    // Calculate Arcane Siege multiplier if applicable (reuses setCount, caches implant lookup)
    performanceTracker.startTimer('CalculateArcaneSiege');
    const arcaneSiegeMultiplier = calculateArcaneSiegeMultiplier(ship, setCount, getGearPiece);
    performanceTracker.endTimer('CalculateArcaneSiege');

    // Apply arena modifiers to stats for scoring (does not affect displayed stats)
    const statsAfterArena =
        arenaModifiers && Object.keys(arenaModifiers).length > 0
            ? applyArenaModifiers(totalStats.final, arenaModifiers)
            : totalStats.final;
    const statsForScoring =
        fleetBuffs && fleetBuffs.length > 0
            ? applyFleetBuffs(statsAfterArena, fleetBuffs)
            : statsAfterArena;

    performanceTracker.startTimer('CalculatePriorityScore');
    const score = calculatePriorityScore(
        statsForScoring,
        priorities,
        shipRole,
        setCount,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arcaneSiegeMultiplier,
        implantSetCount,
        customFormula,
        roleBasis
    );
    performanceTracker.endTimer('CalculatePriorityScore');

    // Cache the result
    performanceTracker.startTimer('CacheResult');
    evictOldestIfFull(scoreCache, CACHE_SIZE_LIMIT);
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
