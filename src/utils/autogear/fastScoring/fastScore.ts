import type { BaseStats } from '../../../types/stats';
import type { StatPriority, SetPriority, StatBonus } from '../../../types/autogear';
import { applyArenaModifiers } from '../arenaModifiers';
import { calculatePriorityScore } from '../priorityScore';
import { fastCalculateStats } from './fastCalculateStats';
import { buildFastCacheKey } from './fastCache';
import { statVectorToBaseStats } from './statVector';
import type { FastScoringContext } from './context';

// Arcane Siege multipliers by rarity — mirrors scoring.ts
const ARCANE_SIEGE_MULTIPLIERS: Record<string, number> = {
    common: 3,
    uncommon: 5,
    rare: 10,
    epic: 15,
    legendary: 20,
};

export interface FastScoreResult {
    fitness: number;
    /** Only populated when context.hasHardRequirements === true. */
    finalStats?: BaseStats;
}

/**
 * Equivalent of calculateTotalScore, but uses the fast-scoring context and
 * operates on integer gear ids instead of string ids.
 *
 * gearIds: array matching context.gearSlotOrder; -1 for empty slots.
 * implantIds: array matching context.implantSlotOrder; -1 for empty slots.
 *   Pass an empty array [] when the GA is not optimizing implants — the
 *   context's `fixedImplantIds` (built from ship.implants) will be used instead.
 *   See Invariant 2.
 */
export function fastScore(
    context: FastScoringContext,
    gearIds: readonly number[],
    implantIds: readonly number[]
): FastScoreResult {
    const { workspace, cache, hasHardRequirements, optimizingImplants, fixedImplantIds } = context;

    // Resolve effective implant ids (fallback to fixedImplantIds when not optimizing implants)
    const effectiveImplantIds = optimizingImplants ? implantIds : fixedImplantIds;

    // Cache key: concat gear ids, separator, implant ids.
    // Omit implants from the key when they're constant (fixedImplantIds) — saves work.
    const cacheKey = optimizingImplants
        ? buildFastCacheKey(gearIds) + '|' + buildFastCacheKey(effectiveImplantIds)
        : buildFastCacheKey(gearIds);

    const cached = cache.get(cacheKey);
    if (cached !== undefined && !hasHardRequirements) {
        return { fitness: cached };
    }

    // Compute stats
    fastCalculateStats(
        {
            registry: context.gearRegistry,
            shipPrefix: context.shipPrefix,
            implantRegistry: context.implantRegistry,
            getImplantPiece: (id) => context.implantRegistry.pieces[id],
            getGearPiece: (id) => context.gearRegistry.pieces[id],
            baseStats: context.ship.baseStats,
            percentRef: context.percentRef,
        },
        workspace,
        gearIds,
        effectiveImplantIds
    );

    // Convert to BaseStats for the priority scorer
    const finalStats = statVectorToBaseStats(workspace.stats);

    // Apply arena modifiers (same as scoring.ts)
    const statsForScoring =
        context.arenaModifiers && Object.keys(context.arenaModifiers).length > 0
            ? applyArenaModifiers(finalStats, context.arenaModifiers)
            : finalStats;

    // Build setCount as Record<string, number> for the priority scorer
    const setCount: Record<string, number> = {};
    for (let setId = 1; setId < workspace.setCount.length; setId++) {
        const c = workspace.setCount[setId];
        if (c > 0) setCount[context.gearRegistry.setIdToName[setId]] = c;
    }

    // Arcane siege — check effectiveImplantIds for ARCANE_SIEGE
    let arcaneSiegeMultiplier = 0;
    const shieldCount = setCount['SHIELD'] || 0;
    if (shieldCount >= 2) {
        for (let i = 0; i < effectiveImplantIds.length; i++) {
            const id = effectiveImplantIds[i];
            if (id < 0) continue;
            const implant = context.implantRegistry.pieces[id];
            if (implant?.setBonus === 'ARCANE_SIEGE') {
                arcaneSiegeMultiplier = ARCANE_SIEGE_MULTIPLIERS[implant.rarity] ?? 0;
                break;
            }
        }
    }

    const fitness = calculatePriorityScore(
        statsForScoring,
        context.priorities as StatPriority[],
        context.shipRole,
        setCount,
        context.setPriorities as SetPriority[],
        context.statBonuses as StatBonus[],
        context.tryToCompleteSets,
        arcaneSiegeMultiplier
    );

    if (!hasHardRequirements) {
        cache.set(cacheKey, fitness);
    }

    return hasHardRequirements ? { fitness, finalStats: statsForScoring } : { fitness };
}
