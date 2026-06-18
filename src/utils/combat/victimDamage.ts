import { AffinityName } from '../../types/ship';
import { calculateDamageReduction } from '../autogear/priorityScore';
import { computeAffinityModifiers } from '../calculators/affinityUtils';

/**
 * Pure per-victim hit-damage calculator.
 *
 * AoE / re-resolution hits land on victims with DIFFERENT defense and affinity,
 * so per-victim damage cannot be derived from the single aggregate the engine
 * computes today (playerTurn.ts:1080-1282). This module recomputes one hit's
 * contribution against a single victim's defensive profile.
 *
 * The decomposition (proven algebraically identical to the engine aggregate in
 * the parity test): the engine's blended crit multiplier
 *
 *     damageCritMultiplier = 1 + (critHits/hits) * (cd/100)
 *
 * is equivalent to splitting `preCritDamage` evenly across `hits` and critting
 * each hit individually:
 *
 *     sum_h [1 + (hitCrits[h]?1:0) * cd/100] = hits + critHits*cd/100
 *                                            = hits * (1 + critFraction*cd/100)
 *                                            = hits * damageCritMultiplier
 *
 * so  sum_h (preCritDamage/hits) * critMult_h * nonCritFactor
 *       = preCritDamage * nonCritFactor * damageCritMultiplier
 *       = preCritDamage * postDefenseFactor   (the aggregate, minus passive).
 *
 * Passive payload damage is a SEPARATE bucket and is NOT handled here.
 *
 * PURE: no engine state, full precision, no per-hit rounding.
 */
export interface AttackerDamageScalars {
    /** attack * (1 + attackBuff/100) — attacker-fixed. */
    effectiveAttack: number;
    /**
     * effectiveMultiplier + conditionalBonusPct, where
     * effectiveMultiplier = rawMultiplier * hits (multiplier ALREADY includes hit count).
     */
    multiplierPct: number;
    /** Secondary-stat damage (defense/hp scaling), added once inside preCritDamage. */
    secondaryStatValue: number;
    /** Hit count — needed to split preCritDamage into per-hit shares. */
    hits: number;
    /** critDamage + critDamageBuff, percent. */
    effectiveCritDamage: number;
    outgoingDamageBuffPct: number;
    incomingDamageModifierPct: number;
    defensePenetrationPct: number;
    /** Attacker affinity; matched against the victim's affinity via computeAffinityModifiers. */
    attackerAffinity: AffinityName;
}

export interface VictimDefenseProfile {
    defence: number;
    /** enemyDefenseModifier — percent. */
    defenceModifierPct: number;
    affinity: AffinityName;
    /** per-victim incoming-damage debuff; when present, overrides the attacker-fixed scalar — B1/PR7b */
    incomingDamageModifierPct?: number;
}

/**
 * Damage dealt to a single victim by ONE hit of a multi-hit skill.
 *
 * @param s        attacker-side scalars (fixed across victims)
 * @param v        this victim's defensive profile
 * @param didCrit  the per-hit crit outcome (hitCrits[h])
 * @param roleScale 1 (origin) | 0.5 (covered) positional split factor
 */
export function victimHitDamage(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number
): number {
    // preCritDamage assembled exactly as the engine, then split evenly per hit.
    const preCritDamage = s.effectiveAttack * (s.multiplierPct / 100) + s.secondaryStatValue;
    const perHitShare = s.hits > 0 ? preCritDamage / s.hits : 0;

    // Per-VICTIM defense (mirrors playerTurn.ts:1115-1117).
    const effectiveDefense =
        v.defence * (1 + v.defenceModifierPct / 100) * (1 - s.defensePenetrationPct / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    // Per-VICTIM affinity (attacker vs this victim), matching computeAffinityModifiers.
    const affinityDamageModifier = computeAffinityModifiers(
        s.attackerAffinity,
        v.affinity
    ).damageModifier;
    const affinityMult = 1 + affinityDamageModifier / 100;

    // Prefer the per-victim incoming-damage debuff when present; fall back to the
    // attacker-fixed scalar (B1/PR7b). Keeps every existing caller byte-identical
    // (callers that do not set incomingDamageModifierPct on the profile are unchanged).
    const incoming = v.incomingDamageModifierPct ?? s.incomingDamageModifierPct;

    const nonCritFactor =
        (1 - damageReduction / 100) *
        (1 + s.outgoingDamageBuffPct / 100) *
        (1 + incoming / 100) *
        affinityMult;

    const hitCritMultiplier = 1 + (didCrit ? 1 : 0) * (s.effectiveCritDamage / 100);

    return perHitShare * hitCritMultiplier * nonCritFactor * roleScale;
}
