import { AffinityName } from '../../types/ship';
import { calculateDamageReduction } from '../autogear/priorityScore';
import { computeAffinityModifiers } from '../calculators/affinityUtils';

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
    /** Attacker affinity; matched against the victim's affinity via computeAffinityModifiers. */
    attackerAffinity: AffinityName;
    /**
     * Forced-affinity override (offensive). When true, this cast's outgoing hits are
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
    /** per-victim incoming-damage debuff; when present, overrides the attacker-fixed scalar */
    incomingDamageModifierPct?: number;
    /**
     * THE VICTIM-SIDE SLICE OF A MIXED CHANNEL (#358).
     *
     * `incomingDamageModifierPct` is NOT one thing. The engine sums FOUR contributions into it
     * (`victimIncomingModifiers`):
     *   • `enemy.incomingDamageModifier` — 'Out. Damage Up' the ATTACKER's side applied. KEEP.
     *   • `exposed` — 'Exposed' stacks the ATTACKER's side applied. KEEP.
     *   • `selfIncoming` — the victim's OWN 'Inc. Damage Down/Up' self-buffs. STRIP.
     *   • `preFightIncoming` — squad-leader incoming protections on the victim. STRIP.
     *
     * The first two AMPLIFY what lands (they are part of "the attacker's attack with modifiers");
     * the last two are the DEFENDER reducing what it takes. "Damage absorbed" counts the attack as
     * thrown, so only the victim-side pair comes off the pre-mitigation axis.
     *
     * THIS FIELD CARRIES THAT PAIR (`selfIncoming + preFightIncoming`), signed exactly as it rides
     * the summed channel (negative = the victim takes less). `preMitigation` below subtracts it
     * back out; `damage` is untouched by it.
     *
     * WHY IT MUST BE THREADED AND NOT DERIVED. Treating `incomingDamageModifierPct` as ATOMIC and
     * leaving the whole term on the pre-defence axis makes a defender with 'Inc. Damage Down II'
     * survive an EXTRA round and report a LOWER figure (252,000 over 6 rounds vs 300,000 over 5).
     * Dropping the term wholesale instead strips the attacker's own amplification, which is
     * equally wrong. Nothing downstream can recover the split from the sum, so the split travels
     * with the profile.
     *
     * Defaults to 0 → inert for any victim with no self-sourced incoming modifier and no
     * pre-fight incoming baseline.
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
     * per-victim enemy-status variation) and passes it here. Defaults to 0 → byte-identical
     * for the primary target (delta is 0 by construction) and for any attacker with no
     * enemy-status-gated outgoing modifier.
     */
    outgoingDamageDeltaPct?: number;
    /**
     * Forced-affinity override (defensive, victim-side). When true, THIS victim carries
     * an 'Defensive Affinity Override' buff (Isha/Nayra) that forces the incoming attacker to
     * affinity DISADVANTAGE (−25% damage) against this victim, superseding the real matchup.
     * An attacker's `s.forceAffinityAdvantage` still wins over this (mirrors playerTurn's
     * override precedence). Undefined → real matchup.
     */
    forceAffinityDisadvantage?: boolean;
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
 * @param v    this victim's defensive profile (defence + defenceModifierPct)
 * @param defensePenetrationPct the ATTACKER's effective defence penetration, percent
 */
export function victimDefenceMitigation(
    v: VictimDefenseProfile,
    defensePenetrationPct: number
): number {
    const effectiveDefense =
        v.defence * (1 + v.defenceModifierPct / 100) * (1 - defensePenetrationPct / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;
    return 1 - damageReduction / 100;
}

/**
 * Damage dealt to a single victim by ONE hit of a multi-hit skill.
 *
 * NO PRODUCTION CALLERS, DELIBERATELY KEPT. Its pre-mitigation sibling
 * (`victimHitDamagePreMitigation`) was deleted for exactly that reason, so the asymmetry is worth
 * stating: this one survives because it is the `.damage`-only façade a dozen unit tests are written
 * against (`victimDamage.test.ts`, `positionalApply.test.ts`), and those tests are real users. It
 * is a one-line delegation to `victimHitDamageParts`, so it cannot drift from the parts helper the
 * way the hand-copied pre-mitigation twin did. Delete it only together with those tests.
 *
 * @param s        attacker-side scalars (fixed across victims)
 * @param v        this victim's defensive profile
 * @param didCrit  the per-hit crit outcome (hitCrits[h])
 * @param roleScale 1 (origin) | 0.5 (covered) positional split factor
 * @param equipReductionPct  VICTIM-side gear/kit incoming %-reduction (percentage points),
 *        folded ADDITIVELY into the incoming term. Default 0 → inert for victims without an
 *        incoming-reduction ability.
 * @param attackerSideReductionPct  the ATTACKER-side half of the same channel — today the
 *        attacker's own squad-leader `outgoingCritDamage` penalty. Same units and same sign
 *        convention, but it belongs to the attack AS THROWN, so it rides BOTH axes. Default 0.
 */
export function victimHitDamage(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    equipReductionPct = 0,
    attackerSideReductionPct = 0
): number {
    return victimHitDamageParts(
        s,
        v,
        didCrit,
        roleScale,
        equipReductionPct,
        attackerSideReductionPct
    ).damage;
}

export function victimHitDamageParts(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    equipReductionPct = 0,
    attackerSideReductionPct = 0
): { damage: number; preMitigation: number } {
    // preCritDamage assembled exactly as the engine, then split evenly per hit.
    const preCritDamage = s.effectiveAttack * (s.multiplierPct / 100) + s.secondaryStatValue;
    const perHitShare = s.hits > 0 ? preCritDamage / s.hits : 0;

    // Per-VICTIM defense (mirrors `runPlayerTurn`'s aggregate). Delegated to victimDefenceMitigation
    // so the engine's Protection cascade can divide by the SAME factor this applies.
    const defenceMitigation = victimDefenceMitigation(v, s.defensePenetrationPct);

    // Per-VICTIM affinity (attacker vs this victim), matching computeAffinityModifiers.
    // A forced-affinity override supersedes the real matchup — offensive advantage
    // (attacker-fixed) wins over this victim's defensive disadvantage, both win over the real
    // matchup. Mirrors playerTurn's `affinityModsVsVictim` precedence so the aggregate and
    // positional paths agree. No override → real matchup.
    const affinityDamageModifier = s.forceAffinityAdvantage
        ? 25
        : v.forceAffinityDisadvantage
          ? -25
          : computeAffinityModifiers(s.attackerAffinity, v.affinity).damageModifier;
    const affinityMult = 1 + affinityDamageModifier / 100;

    // Prefer the per-victim incoming-damage debuff when present; fall back to the
    // attacker-fixed scalar. The engine-wired path always passes an explicit
    // value; the `??` fallback serves direct-call callers (e.g. positionalApply unit tests).
    const incomingChannel = v.incomingDamageModifierPct ?? s.incomingDamageModifierPct;
    // BYTE-IDENTITY: the two halves are re-SUMMED before the subtraction, in the same
    // left-to-right order the engine used when it handed over one fused number
    // (`(equip + victimCritTerm) + attackerCritTerm`). `a - (b + c)` and `a - b - c` are not the
    // same double, and splitting the channel must not move a single existing damage figure.
    const incoming = incomingChannel - (equipReductionPct + attackerSideReductionPct);
    // #358: the SAME channel with every victim-side reduction removed, and ONLY
    // those. Three things come off / stay on:
    //   • OFF — the victim's own `Inc. Damage Down` family and its pre-fight incoming baseline,
    //     both carried in `victimSideIncomingPct`;
    //   • OFF — `equipReductionPct`, the gear/kit incoming reduction, which is simply not
    //     added to this axis;
    //   • ON  — `attackerSideReductionPct`, subtracted here as well as above. It is the ATTACKER's
    //     own squad-leader `outgoingCritDamage` penalty: it makes the attack smaller AS THROWN, so
    //     excluding it would over-report. It rides its own parameter for that reason: fused into
    //     `equipReductionPct` it comes off the thrown axis as collateral — a MIXED channel treated
    //     as atomic, the same defect shape one layer further down.
    // What survives is the attack as thrown, including attacker-APPLIED amplification
    // (`Out. Damage Up`, `Exposed`). See `victimSideIncomingPct` for why the split is threaded.
    const incomingAsThrown =
        incomingChannel - (v.victimSideIncomingPct ?? 0) - attackerSideReductionPct;

    // PR I2: fold the per-victim enemy-status-gated delta additively into the same
    // percentage term as the attacker-fixed outgoing buff — both are additive-percentage
    // contributions to the SAME `(1 + x/100)` multiplier, so there is no rounding
    // divergence from a single-victim (delta === 0) evaluation.
    const outgoingPct = s.outgoingDamageBuffPct + (v.outgoingDamageDeltaPct ?? 0);
    const nonCritFactor =
        defenceMitigation * (1 + outgoingPct / 100) * (1 + incoming / 100) * affinityMult;
    // #358 ADDENDUM 2/3: the same product with EVERY victim-side reduction removed — the defence
    // term replaced by an exact 1 (addendum 2) and the incoming term re-based on `incomingAsThrown`
    // (addendum 3). The `damage` expression below keeps its original operand order and its original
    // `incoming` local, so it stays BYTE-IDENTICAL (no re-association), while the pre-mitigation
    // figure is computed at source rather than reconstructed by division.
    const nonCritFactorPreDefence =
        1 * (1 + outgoingPct / 100) * (1 + incomingAsThrown / 100) * affinityMult;

    const hitCritMultiplier = 1 + (didCrit ? 1 : 0) * (s.effectiveCritDamage / 100);

    return {
        damage: perHitShare * hitCritMultiplier * nonCritFactor * roleScale,
        preMitigation: perHitShare * hitCritMultiplier * nonCritFactorPreDefence * roleScale,
    };
}
