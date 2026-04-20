import type { BaseStats, StatName } from '../../types/stats';

/**
 * Fixed-index Float64Array stat layout used by the autogear fast-scoring hot loop.
 * Order is frozen — modules consuming StatVectors rely on this exact index map.
 * Additions go at the end to preserve existing indices.
 */
export const STAT_INDEX: Record<StatName, number> = {
    hp: 0,
    attack: 1,
    defence: 2,
    speed: 3,
    hacking: 4,
    security: 5,
    crit: 6,
    critDamage: 7,
    healModifier: 8,
    shield: 9,
    hpRegen: 10,
    defensePenetration: 11,
    shieldPenetration: 12,
    damageReduction: 13,
};

export const STAT_COUNT = 14;

export type StatVector = Float64Array;

export function createStatVector(): StatVector {
    return new Float64Array(STAT_COUNT);
}

export function copyStatVector(src: StatVector, dst: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) dst[i] = src[i];
}

export function addStatVector(target: StatVector, addend: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) target[i] += addend[i];
}

export function zeroStatVector(target: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) target[i] = 0;
}

/**
 * Convert a StatVector back to a BaseStats object. Used for:
 * - Passing to the existing calculatePriorityScore (which takes BaseStats)
 * - Equivalence testing against calculateTotalStats
 */
export function statVectorToBaseStats(v: StatVector): BaseStats {
    return {
        hp: v[STAT_INDEX.hp],
        attack: v[STAT_INDEX.attack],
        defence: v[STAT_INDEX.defence],
        speed: v[STAT_INDEX.speed],
        hacking: v[STAT_INDEX.hacking],
        security: v[STAT_INDEX.security],
        crit: v[STAT_INDEX.crit],
        critDamage: v[STAT_INDEX.critDamage],
        healModifier: v[STAT_INDEX.healModifier],
        shield: v[STAT_INDEX.shield],
        hpRegen: v[STAT_INDEX.hpRegen],
        defensePenetration: v[STAT_INDEX.defensePenetration],
        shieldPenetration: v[STAT_INDEX.shieldPenetration],
        damageReduction: v[STAT_INDEX.damageReduction],
    };
}

/**
 * Inverse of statVectorToBaseStats. Missing BaseStats fields default to 0.
 */
export function baseStatsToStatVector(s: BaseStats, target?: StatVector): StatVector {
    const v = target ?? createStatVector();
    v[STAT_INDEX.hp] = s.hp ?? 0;
    v[STAT_INDEX.attack] = s.attack ?? 0;
    v[STAT_INDEX.defence] = s.defence ?? 0;
    v[STAT_INDEX.speed] = s.speed ?? 0;
    v[STAT_INDEX.hacking] = s.hacking ?? 0;
    v[STAT_INDEX.security] = s.security ?? 0;
    v[STAT_INDEX.crit] = s.crit ?? 0;
    v[STAT_INDEX.critDamage] = s.critDamage ?? 0;
    v[STAT_INDEX.healModifier] = s.healModifier ?? 0;
    v[STAT_INDEX.shield] = s.shield ?? 0;
    v[STAT_INDEX.hpRegen] = s.hpRegen ?? 0;
    v[STAT_INDEX.defensePenetration] = s.defensePenetration ?? 0;
    v[STAT_INDEX.shieldPenetration] = s.shieldPenetration ?? 0;
    v[STAT_INDEX.damageReduction] = s.damageReduction ?? 0;
    return v;
}
