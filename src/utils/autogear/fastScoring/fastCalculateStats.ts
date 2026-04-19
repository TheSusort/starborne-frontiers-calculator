import { GEAR_SETS } from '../../../constants/gearSets';
import type { GearPiece } from '../../../types/gear';
import type { BaseStats, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { STAT_INDEX, type StatVector, copyStatVector, createStatVector } from './statVector';
import type { GearRegistry } from './gearRegistry';
import { addPieceStatsInto } from './gearRegistry';

export interface FastCalcWorkspace {
    /** Running stats vector. Reused across calls; zeroed at start of each call. */
    stats: StatVector;
    /** Set count buffer, length = registry.setIdToName.length. */
    setCount: Uint8Array;
}

export function createWorkspace(setCount: number): FastCalcWorkspace {
    return {
        stats: createStatVector(),
        setCount: new Uint8Array(setCount),
    };
}

export interface FastCalcInputs {
    readonly registry: GearRegistry;
    readonly shipPrefix: StatVector;
    readonly implantRegistry: GearRegistry; // separate registry for implants
    readonly getImplantPiece: (id: number) => GearPiece;
    readonly getGearPiece: (id: number) => GearPiece;
    /** Ship's raw base stats — only used for the damageReduction cap guard. */
    readonly baseStats: BaseStats;
    /**
     * Percentage reference for gear / set-bonus / implant percentage stats.
     * MUST equal the slow path's `afterEngineering` — i.e. statVectorToBaseStats(shipPrefix).
     * See Invariant 1.
     */
    readonly percentRef: BaseStats;
}

/**
 * Fill `workspace.stats` with the "final" stat vector for an individual.
 *
 * gearIds: one int per gear slot; -1 = empty.
 * implantIds: one int per implant slot; -1 = empty.
 *
 * Mirrors calculateTotalStats in statsCalculator.ts (stages 4–8).
 */
export function fastCalculateStats(
    inputs: FastCalcInputs,
    workspace: FastCalcWorkspace,
    gearIds: readonly number[],
    implantIds: readonly number[]
): void {
    const { registry, shipPrefix, implantRegistry, getImplantPiece, baseStats, percentRef } =
        inputs;
    const { stats, setCount } = workspace;

    // Stage 1-3: copy prefix into stats
    copyStatVector(shipPrefix, stats);

    // Stage 4: gear contributions (main + sub stats) — precomputed per piece
    // Also accumulate setCount at the same time
    setCount.fill(0);
    for (let i = 0; i < gearIds.length; i++) {
        const id = gearIds[i];
        if (id < 0) continue;
        addPieceStatsInto(registry, id, stats);
        const setId = registry.setIds[id];
        if (setId !== 0) setCount[setId]++;
    }

    // Stage 5: set bonuses — percentage stats reference afterEngineering (= percentRef)
    applySetBonuses(stats, setCount, registry, percentRef);

    // Stage 6: implant sub stats (precomputed vectors already use percentRef)
    for (let i = 0; i < implantIds.length; i++) {
        const id = implantIds[i];
        if (id < 0) continue;
        addPieceStatsInto(implantRegistry, id, stats);
    }

    // Stage 7: special implant multipliers (CODE_GUARD, CIPHER_LINK) — based on final stats
    applySpecialImplants(stats, implantIds, getImplantPiece);

    // Stage 8: damageReduction cap. Match the slow path guard EXACTLY:
    //   slow path: if (breakdown.base.damageReduction && breakdown.final.damageReduction)
    // Both must be truthy (non-zero, non-undefined). See Invariant 3.
    const innateDR = baseStats.damageReduction;
    const finalDR = stats[STAT_INDEX.damageReduction];
    if (innateDR && finalDR) {
        const gearDR = finalDR - innateDR;
        stats[STAT_INDEX.damageReduction] = Math.max(innateDR, gearDR);
    }
}

function applySetBonuses(
    stats: StatVector,
    setCount: Uint8Array,
    registry: GearRegistry,
    percentRef: BaseStats
): void {
    for (let setId = 1; setId < setCount.length; setId++) {
        const count = setCount[setId];
        if (count === 0) continue;
        const setName = registry.setIdToName[setId];
        const setDef = GEAR_SETS[setName];
        if (!setDef?.stats) continue;
        const minPieces = setDef.minPieces || 2;
        const bonusCount = Math.floor(count / minPieces);
        if (bonusCount === 0) continue;

        // Apply setDef.stats bonusCount times, using percentRef (afterEngineering)
        // as the percentage reference — matches slow path statsCalculator.ts:159.
        for (let b = 0; b < bonusCount; b++) {
            for (const stat of setDef.stats) applyStat(stat, stats, percentRef);
        }
    }
}

function applySpecialImplants(
    stats: StatVector,
    implantIds: readonly number[],
    getImplantPiece: (id: number) => GearPiece
): void {
    for (let i = 0; i < implantIds.length; i++) {
        const id = implantIds[i];
        if (id < 0) continue;
        const implant = getImplantPiece(id);
        if (!implant?.setBonus) continue;
        const mult = getSpecialImplantMultiplier(implant.setBonus, implant.rarity);
        if (mult === null) continue;

        if (implant.setBonus === 'CODE_GUARD') {
            stats[STAT_INDEX.security] += stats[STAT_INDEX.hacking] * (mult / 100);
        } else if (implant.setBonus === 'CIPHER_LINK') {
            stats[STAT_INDEX.hacking] += stats[STAT_INDEX.security] * (mult / 100);
        }
    }
}

function getSpecialImplantMultiplier(setBonus: string, rarity: string): number | null {
    if (setBonus === 'CODE_GUARD') {
        const m: Record<string, number> = {
            common: 20,
            uncommon: 25,
            rare: 30,
            epic: 35,
            legendary: 40,
        };
        return m[rarity] ?? null;
    }
    if (setBonus === 'CIPHER_LINK') {
        const m: Record<string, number> = {
            common: 20,
            uncommon: 25,
            rare: 31,
            epic: 37,
            legendary: 45,
        };
        return m[rarity] ?? null;
    }
    return null;
}

function applyStat(stat: Stat, target: StatVector, percentRef: BaseStats): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const refValue = (percentRef as unknown as Record<string, number>)[stat.name] ?? 0;
        target[idx] += refValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}
