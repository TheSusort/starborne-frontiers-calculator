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
    /**
     * SP-F F4: forced-affinity override (offensive). When true, this cast's outgoing hits are
     * forced to affinity ADVANTAGE (+25% damage) against EVERY victim, superseding the real
     * matchup — Wusheng's charged "deals 220% damage with affinity advantage" and the
     * Isha/Nayra 'Offensive Affinity Override' self-buff. Takes precedence over a victim's
     * defensive override (mirrors playerTurn's `affinityModsVsVictim`). Undefined → real matchup.
     */
    forceAffinityAdvantage?: boolean;
}

export interface VictimDefenseProfile {
    defence: number;
    /** enemyDefenseModifier — percent. */
    defenceModifierPct: number;
    affinity: AffinityName;
    /** per-victim incoming-damage debuff; when present, overrides the attacker-fixed scalar — B1/PR7b */
    incomingDamageModifierPct?: number;
    /**
     * Sub-project I, PR I2 (Layer 3) — this victim's outgoing-damage-modifier DELTA vs the
     * attacker-fixed `s.outgoingDamageBuffPct`. `s.outgoingDamageBuffPct` is folded ONCE per
     * turn against the primary (bound) target's enemy-status; an enemy-status-gated modifier
     * (Tygr's "+30% to enemies with Stasis/Disable", Incinerator's "+30% to Inferno enemies",
     * Lodolite's "+15% to enemies with Concentrate Fire") must instead vary PER FOOTPRINT
     * VICTIM in an AoE. Rather than re-deriving the full outgoing term per victim, the engine
     * computes ONLY the delta between that victim's own enemy-status ctx and the primary
     * target's ctx (non-enemy-status modifiers cancel identically in both folds, isolating the
     * per-victim enemy-status variation) and passes it here. Defaults to 0 → byte-identical
     * for the primary target (delta is 0 by construction) and for any attacker with no
     * enemy-status-gated outgoing modifier.
     */
    outgoingDamageDeltaPct?: number;
    /**
     * SP-F F4: forced-affinity override (defensive, victim-side). When true, THIS victim carries
     * an 'Defensive Affinity Override' buff (Isha/Nayra) that forces the incoming attacker to
     * affinity DISADVANTAGE (−25% damage) against this victim, superseding the real matchup.
     * An attacker's `s.forceAffinityAdvantage` still wins over this (mirrors playerTurn's
     * override precedence). Undefined → real matchup.
     */
    forceAffinityDisadvantage?: boolean;
}

/**
 * Damage dealt to a single victim by ONE hit of a multi-hit skill.
 *
 * @param s        attacker-side scalars (fixed across victims)
 * @param v        this victim's defensive profile
 * @param didCrit  the per-hit crit outcome (hitCrits[h])
 * @param roleScale 1 (origin) | 0.5 (covered) positional split factor
 * @param equipReductionPct  D-PR3 victim-side incoming %-reduction (percentage points),
 *        folded ADDITIVELY into the incoming term. Default 0 → byte-identical to the
 *        pre-D-PR3 behavior (inert for victims without an incoming-reduction ability).
 */
export function victimHitDamage(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    equipReductionPct = 0
): number {
    // preCritDamage assembled exactly as the engine, then split evenly per hit.
    const preCritDamage = s.effectiveAttack * (s.multiplierPct / 100) + s.secondaryStatValue;
    const perHitShare = s.hits > 0 ? preCritDamage / s.hits : 0;

    // Per-VICTIM defense (mirrors playerTurn.ts:1115-1117).
    const effectiveDefense =
        v.defence * (1 + v.defenceModifierPct / 100) * (1 - s.defensePenetrationPct / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    // Per-VICTIM affinity (attacker vs this victim), matching computeAffinityModifiers.
    // SP-F F4: a forced-affinity override supersedes the real matchup — offensive advantage
    // (attacker-fixed) wins over this victim's defensive disadvantage, both wins over the real
    // matchup. Mirrors playerTurn's `affinityModsVsVictim` precedence so the aggregate and
    // positional paths agree. No override → real matchup → byte-identical default.
    const affinityDamageModifier = s.forceAffinityAdvantage
        ? 25
        : v.forceAffinityDisadvantage
          ? -25
          : computeAffinityModifiers(s.attackerAffinity, v.affinity).damageModifier;
    const affinityMult = 1 + affinityDamageModifier / 100;

    // Prefer the per-victim incoming-damage debuff when present; fall back to the
    // attacker-fixed scalar (B1/PR7b). The engine-wired path always passes an explicit
    // value; the `??` fallback serves direct-call callers (e.g. positionalApply unit tests).
    const incoming =
        (v.incomingDamageModifierPct ?? s.incomingDamageModifierPct) - equipReductionPct;

    // PR I2: fold the per-victim enemy-status-gated delta additively into the same
    // percentage term as the attacker-fixed outgoing buff — both are additive-percentage
    // contributions to the SAME `(1 + x/100)` multiplier, so there is no rounding
    // divergence from a single-victim (delta === 0) evaluation.
    const outgoingPct = s.outgoingDamageBuffPct + (v.outgoingDamageDeltaPct ?? 0);
    const nonCritFactor =
        (1 - damageReduction / 100) * (1 + outgoingPct / 100) * (1 + incoming / 100) * affinityMult;

    const hitCritMultiplier = 1 + (didCrit ? 1 : 0) * (s.effectiveCritDamage / 100);

    return perHitShare * hitCritMultiplier * nonCritFactor * roleScale;
}
