import { AffinityName } from '../../types/ship';
import { calculateDamageReduction } from '../autogear/priorityScore';
import { affinityModifiersWithOverrides } from '../calculators/affinityUtils';

/**
 * Pure per-victim hit-damage calculator.
 *
 * AoE / re-resolution hits land on victims with DIFFERENT defense and affinity,
 * so per-victim damage cannot be derived from the single aggregate the engine
 * computes in `runPlayerTurn`. This module recomputes one hit's
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
    /** Attacker affinity; matched against the victim's affinity via
     *  `affinityModifiersWithOverrides`. */
    attackerAffinity: AffinityName;
    /**
     * Forced-affinity override (offensive). When true, this cast's outgoing hits are
     * forced to affinity ADVANTAGE (+25% damage) against EVERY victim, superseding the real
     * matchup — Wusheng's charged "deals 220% damage with affinity advantage" and the
     * Isha/Nayra 'Offensive Affinity Override' self-buff. Takes precedence over a victim's
     * defensive override (precedence: `affinityModifiersWithOverrides`). Undefined → real matchup.
     */
    forceAffinityAdvantage?: boolean;
}

export interface VictimDefenseProfile {
    defence: number;
    /** enemyDefenseModifier — percent. */
    defenceModifierPct: number;
    /** Flat defence (absolute units) added after the percentage term — Terran Guard's applier
     *  snapshot and Magnetized Shielding's 10x security (`flatDefence`, buffTotals.ts). Absent → 0. */
    defenceFlat?: number;
    affinity: AffinityName;
    /** per-victim incoming-damage debuff; when present, overrides the attacker-fixed scalar */
    incomingDamageModifierPct?: number;
    /**
     * THE VICTIM-SIDE SLICE OF A MIXED CHANNEL (#358).
     *
     * `incomingDamageModifierPct` is NOT one thing. The engine sums THREE contributions into it
     * (`victimIncomingModifiers`):
     *   • `enemy.incomingDamageModifier` — 'Out. Damage Up' the ATTACKER's side applied. KEEP.
     *   • `exposed` — 'Exposed' stacks the ATTACKER's side applied. KEEP.
     *   • `selfIncoming` — the victim's OWN 'Inc. Damage Down/Up' self-buffs. STRIP.
     *
     * The first two AMPLIFY what lands (they are part of "the attacker's attack with modifiers");
     * the last is the DEFENDER reducing what it takes. "Damage absorbed" counts the attack as
     * thrown, so only the victim's own slice comes off the pre-mitigation axis.
     *
     * THIS FIELD CARRIES THAT SLICE (`selfIncoming − ownSuppressed`), signed exactly as it rides
     * the summed channel (negative = the victim takes less). `preMitigation` below subtracts it
     * back out; `damage` is untouched by it. The squad-leader incoming baseline is NOT in the
     * channel at all: it is a separate multiplicative factor composed with gear/implant
     * reductions (`hitReductionFor`, `composeIncomingFactor`), so it never reaches this axis.
     *
     * WHY IT MUST BE THREADED AND NOT DERIVED. Treating `incomingDamageModifierPct` as ATOMIC and
     * leaving the whole term on the pre-defence axis makes a defender with 'Inc. Damage Down II'
     * survive an EXTRA round and report a LOWER figure (252,000 over 6 rounds vs 300,000 over 5).
     * Dropping the term wholesale instead strips the attacker's own amplification, which is
     * equally wrong. Nothing downstream can recover the split from the sum, so the split travels
     * with the profile.
     *
     * Defaults to 0 → inert for any victim with no self-sourced incoming modifier.
     */
    victimSideIncomingPct?: number;
    /**
     * This victim's outgoing-damage-modifier DELTA vs the
     * attacker-fixed `s.outgoingDamageBuffPct`. `s.outgoingDamageBuffPct` is folded ONCE per
     * turn against the primary (bound) target's enemy-status; an enemy-status-gated modifier
     * (Tygr's "+30% to enemies with Stasis/Disable", Incinerator's "+30% to Inferno enemies",
     * Lodolite's "+15% to enemies with Concentrate Fire") must instead vary PER FOOTPRINT
     * VICTIM in an AoE. Rather than re-deriving the full outgoing term per victim, the engine
     * computes ONLY the delta between that victim's own enemy-status ctx and the primary
     * target's ctx (non-enemy-status modifiers cancel identically in both folds, isolating the
     * per-victim enemy-status variation) and passes it here. Defaults to 0, which is also the
     * primary target's own value (delta is 0 by construction) and the value for any attacker with
     * no enemy-status-gated outgoing modifier.
     */
    outgoingDamageDeltaPct?: number;
    /**
     * This victim's crit-power DELTA (percentage points) vs `s.effectiveCritDamage`, which is
     * folded once against the bound target. A victim-gated crit-power modifier ("10% more
     * critical damage to defenders") varies per footprint victim; same delta construction as
     * `outgoingDamageDeltaPct`. Defaults to 0.
     */
    critDamageDeltaPct?: number;
    /**
     * This victim's skill-multiplier DELTA (percentage points) vs `s.multiplierPct`, whose
     * count-scaled bonus ("an additional 30% damage for each buff on the enemy") is scored once
     * against the bound target. Each struck enemy counts its OWN buffs, so the engine supplies
     * the difference between this victim's score and the bound target's. Added once per cast,
     * like the bonus itself. Defaults to 0 — the bound target's own value by construction.
     */
    multiplierDeltaPct?: number;
    /**
     * Forced-affinity override (defensive, victim-side). When true, THIS victim carries
     * an 'Defensive Affinity Override' buff (Isha/Nayra) that forces the incoming attacker to
     * affinity DISADVANTAGE (−25% damage) against this victim, superseding the real matchup.
     * An attacker's `s.forceAffinityAdvantage` still wins over this (precedence:
     * `affinityModifiersWithOverrides`). Undefined → real matchup.
     */
    forceAffinityDisadvantage?: boolean;
}

/** Magnitude of the floor on the non-defence incoming factor. See {@link composeIncomingFactor}. */
export const NON_DEFENCE_REDUCTION_CAP_PCT = 70;

/**
 * A victim's incoming reductions for ONE hit, kept in the buckets the game composes separately
 * (#672, owner-measured). The buff/debuff channel is not here — it travels on the defence profile
 * as `incomingDamageModifierPct`.
 *   • `passivePct` — every ship-skill passive reduction that applies (own kit and ally auras).
 *     They ADD with each other. Positive = takes less.
 *   • `separatePcts` — each gear set, implant and squad-leader reduction. Each is its OWN factor.
 */
export interface IncomingReductionParts {
    passivePct: number;
    separatePcts: readonly number[];
}

export const NO_INCOMING_REDUCTION: IncomingReductionParts = { passivePct: 0, separatePcts: [] };

export function mergeIncomingReductionParts(
    a: IncomingReductionParts,
    b: IncomingReductionParts
): IncomingReductionParts {
    return {
        passivePct: a.passivePct + b.passivePct,
        separatePcts: [...a.separatePcts, ...b.separatePcts],
    };
}

/**
 * THE non-defence incoming factor of a direct hit (#672):
 *   (1 + buffs/100) × (1 − passives/100) × Π(1 − separate/100), floored at a 70% reduction.
 * `buffChannelPct` is signed (negative = takes less). The attacker's outgoing modifiers, crit
 * damage and its squad-leader crit term are NOT part of this product and are never capped.
 * A buff-only victim gets exactly `1 + buffChannelPct/100`, so fights without passives or gear
 * keep their numbers bit for bit.
 */
export function composeIncomingFactor(
    buffChannelPct: number,
    parts: IncomingReductionParts = NO_INCOMING_REDUCTION
): number {
    let factor = 1 + buffChannelPct / 100;
    if (parts.passivePct !== 0) factor *= Math.max(0, 1 - parts.passivePct / 100);
    for (const pct of parts.separatePcts) factor *= Math.max(0, 1 - pct / 100);
    return Math.max(factor, 1 - NON_DEFENCE_REDUCTION_CAP_PCT / 100);
}

/** The reduction factor on a DoT tick: passives sum, separate factors multiply, no cap.
 *  The ticking victim's `Inc. DoT Damage Up` is not part of it: it sits additively in the tick's
 *  dotMult (`victimDotMult` in engine.ts), and this factor multiplies that. */
export function composeDotReductionFactor(parts: IncomingReductionParts): number {
    let factor = parts.passivePct !== 0 ? Math.max(0, 1 - parts.passivePct / 100) : 1;
    for (const pct of parts.separatePcts) factor *= Math.max(0, 1 - pct / 100);
    return factor;
}

/**
 * The DEFENCE factor this victim applies to an incoming hit — the `(1 − damageReduction/100)`
 * term of `victimHitDamage` below, isolated so a consumer that needs to UNDO the mitigation can
 * read the exact factor that was applied instead of re-deriving one from the victim's live stats.
 *
 * The engine's Protection cascade is that consumer: it recovers the pre-defence amount `P` from
 * an already-mitigated hit (`P = damage / targetMitigation`) so a redirected chunk can be
 * re-mitigated on the PROTECTOR's defence. A re-derivation there silently omitted whatever the
 * caller had folded in — the attacker's defence penetration, and the difference between the
 * victim's raw and buff-folded defence stat — and skewed every chunk. Exported so the two can
 * never drift again: `victimHitDamage` applies this and nothing else as its defence term.
 *
 * @param v    this victim's defensive profile (defence × (1 + defenceModifierPct) + defenceFlat)
 * @param defensePenetrationPct the ATTACKER's effective defence penetration, percent
 */
export function victimDefenceMitigation(
    v: VictimDefenseProfile,
    defensePenetrationPct: number
): number {
    return 1 - victimDefenceReductionPct(v, defensePenetrationPct) / 100;
}

/** The damage-reduction percentage behind `victimDefenceMitigation` — for a caller whose model
 *  takes the percentage (Nosorog's bounce, `reflectedDamageParts`) and must land on the exact
 *  factor `victimDefenceMitigation` returns. */
export function victimDefenceReductionPct(
    v: VictimDefenseProfile,
    defensePenetrationPct: number
): number {
    const effectiveDefense =
        (v.defence * (1 + v.defenceModifierPct / 100) + (v.defenceFlat ?? 0)) *
        (1 - defensePenetrationPct / 100);
    return effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;
}

/**
 * Damage dealt to a single victim by ONE hit of a multi-hit skill.
 *
 * NO PRODUCTION CALLERS, DELIBERATELY KEPT: it is the `.damage`-only façade the unit tests are
 * written against, and those tests are real users. It is a one-line delegation to
 * `victimHitDamageParts`, so it cannot drift from the parts helper. Delete it only together with
 * those tests.
 *
 * @param s        attacker-side scalars (fixed across victims)
 * @param v        this victim's defensive profile
 * @param didCrit  the per-hit crit outcome (hitCrits[h])
 * @param roleScale 1 (origin) | 0.5 (covered) positional split factor
 * @param reduction  the VICTIM's bucketed incoming reductions for this hit (ship passives, and
 *        each gear/implant/squad-leader reduction as its own factor). Composed with the buff
 *        channel by `composeIncomingFactor`, capped there. Default: none.
 * @param attackerCritPenaltyPct  the ATTACKER's squad-leader crit penalty for this hit, percent,
 *        positive = its crits deal less. Not a victim reduction: it multiplies outside the cap
 *        and rides both the damage and the "as thrown" axes. Default 0.
 */
export function victimHitDamage(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    reduction: IncomingReductionParts = NO_INCOMING_REDUCTION,
    attackerCritPenaltyPct = 0
): number {
    return victimHitDamageParts(s, v, didCrit, roleScale, reduction, attackerCritPenaltyPct).damage;
}

export function victimHitDamageParts(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    reduction: IncomingReductionParts = NO_INCOMING_REDUCTION,
    attackerCritPenaltyPct = 0
): { damage: number; preMitigation: number; reflectBase: number } {
    // preCritDamage assembled exactly as the engine, then split evenly per hit.
    const multiplierPct = s.multiplierPct + (v.multiplierDeltaPct ?? 0);
    const preCritDamage = s.effectiveAttack * (multiplierPct / 100) + s.secondaryStatValue;
    const perHitShare = s.hits > 0 ? preCritDamage / s.hits : 0;

    // Per-VICTIM defense (mirrors `runPlayerTurn`'s aggregate). Delegated to victimDefenceMitigation
    // so the engine's Protection cascade can divide by the SAME factor this applies.
    const defenceMitigation = victimDefenceMitigation(v, s.defensePenetrationPct);

    // Per-VICTIM affinity (attacker vs this victim), forced-affinity overrides included.
    const affinityDamageModifier = affinityModifiersWithOverrides(s.attackerAffinity, v.affinity, {
        forceAdvantage: s.forceAffinityAdvantage,
        forceDisadvantage: v.forceAffinityDisadvantage,
    }).damageModifier;
    const affinityMult = 1 + affinityDamageModifier / 100;

    // Prefer the per-victim incoming-damage debuff when present; fall back to the
    // attacker-fixed scalar. The engine-wired path always passes an explicit
    // value; the `??` fallback serves direct-call callers (e.g. positionalApply unit tests).
    const incomingChannel = v.incomingDamageModifierPct ?? s.incomingDamageModifierPct;
    // THE composition (#672): buff channel × victim passives × each separate reduction, capped.
    // The attacker's own squad-leader crit penalty is NOT a victim reduction: it multiplies
    // outside the cap, on both axes.
    const incomingFactor = composeIncomingFactor(incomingChannel, reduction);
    const attackerCritFactor = 1 - attackerCritPenaltyPct / 100;
    // "Damage as thrown" (#358): the buff channel minus its victim-side slice
    // (`victimSideIncomingPct`), with no passive or separate reduction and no cap. Attacker-applied
    // amplification (`Out. Damage Up`, `Exposed`) and the attacker's crit penalty stay on.
    const incomingAsThrown = incomingChannel - (v.victimSideIncomingPct ?? 0);

    // The per-victim enemy-status-gated delta and the attacker-fixed outgoing buff are additive
    // contributions to the SAME `(1 + x/100)` multiplier.
    const outgoingPct = s.outgoingDamageBuffPct + (v.outgoingDamageDeltaPct ?? 0);
    const nonCritFactor =
        defenceMitigation *
        (1 + outgoingPct / 100) *
        incomingFactor *
        attackerCritFactor *
        affinityMult;
    // The same product with every victim-side reduction removed: the defence term is an exact 1
    // and the incoming term is re-based on `incomingAsThrown`.
    const nonCritFactorPreDefence =
        1 *
        (1 + outgoingPct / 100) *
        (1 + incomingAsThrown / 100) *
        attackerCritFactor *
        affinityMult;

    const hitCritMultiplier =
        1 + (didCrit ? 1 : 0) * ((s.effectiveCritDamage + (v.critDamageDeltaPct ?? 0)) / 100);

    return {
        damage: perHitShare * hitCritMultiplier * nonCritFactor * roleScale,
        preMitigation: perHitShare * hitCritMultiplier * nonCritFactorPreDefence * roleScale,
        // The hit as thrown, before every multiplier: no crit, outgoing, affinity, defence or
        // incoming term. What a reflector reflects its percentage of (#678).
        reflectBase: perHitShare * roleScale,
    };
}
