/**
 * Pure reflected ("thorns") damage calculator for the Reflect gear set.
 *
 * When a ship wearing Reflect takes a direct hit, it reflects a portion of the
 * damage back at the attacker. This module computes that raw reflected amount
 * **before shield absorb** — shield is applied at the engine seam in a
 * separate task.
 *
 * Empirically-validated model (two in-game duels):
 *   reflected = pct% × netHpDamage × affinityFactor
 *               × (1 − defenceReduction/100)
 *               × (1 − incomingReductionPct/100)
 *
 * Affinity argument order convention:
 *   The WEARER is the source of the reflected hit. Call
 *   `computeAffinityModifiers(wearer.affinity, attacker.affinity)`
 *   and pass `.damageModifier` as `affinityDamageModifier`.
 */
export function reflectedDamageForHit(args: {
    /** Reflect percentage, e.g. 10 for 10 % */
    reflectPct: number;
    /** HP the wearer actually lost on this hit (net, after wearer's own shield) */
    netHpDamage: number;
    /** From computeAffinityModifiers(wearer, attacker).damageModifier — one of -25 | 0 | 25 */
    affinityDamageModifier: number;
    /** calculateDamageReduction(attacker effective defence), range 0..~88 */
    attackerDefenceReductionPct: number;
    /**
     * Incoming-reduction % on the RECIPIENT of the bounce-back (default 0).
     *
     * ⚠️ THE NAME LIES ABOUT THE SIDE. "attacker" here is positional, not causal: it names the
     * ship that threw the original hit, which is the ship the reflected hit lands ON. So this is
     * the bounce-back VICTIM's own `incoming-reduction` family — the D-PR3 channel — resolved at
     * `engine.ts` as `incomingReductionForHit(incomingAbilitiesOf(attacker.id), …)`. It is a
     * VICTIM-SIDE reduction in every sense that matters to #358, and reading the prefix as
     * "attacker-side" is exactly how the reflect channel stayed inverted through a full review.
     * Not renamed here only because `attackerDefenceReductionPct` next to it carries the same
     * positional convention and splitting the two would be worse; the warning travels instead.
     */
    attackerIncomingReductionPct: number;
}): number {
    return reflectedDamageParts(args).damage;
}

/**
 * #358 ADDENDUM 2/3: BOTH axes of one reflected hit, from ONE evaluation.
 *
 *  • `damage`       — what the recipient takes: the full empirical model above, every term intact.
 *  • `preMitigation` — the "damage absorbed" axis (C2): the same hit with EVERY reduction that
 *    belongs to the recipient removed. Two terms go, both replaced by an exact 1:
 *    `attackerDefenceReductionPct` (addendum 2) and `attackerIncomingReductionPct` (addendum 3).
 *    What survives is the hit as THROWN — the reflect percentage, the reflector's affinity, and
 *    the `netHpDamage` the reflector actually took.
 *
 * WHY `attackerIncomingReductionPct` COMES OUT (it used to be folded into both). The previous
 * revision of this comment argued the opposite: that stripping it was "a separate, unmade decision
 * (this module's own duel-fit model owns it)". That argument is WRONG, and it is wrong in a way
 * worth spelling out, because a comment arguing against a fix is how the defect survived a review.
 * The duel-fit model governs `damage` — the number the recipient's HP bar actually loses — and
 * `damage` is untouched by this. `preMitigation` is not a fit to anything; it is by construction a
 * DEPARTURE from the fit, since it already replaces the fitted defence term with a literal 1. A
 * term cannot be defended as load-bearing for an empirical constant on an axis that no constant is
 * fitted against.
 * MEASURED, on a defender swinging 200% of 50,000 attack into a 50%-reflect enemy over 4 rounds:
 * `0% incoming-reduction -> 200,000 absorbed` · `30% -> 140,000` · `60% -> 80,000`, with IDENTICAL
 * round counts. A purely defensive passive quartered its owner's own headline number — the same
 * inversion the defence term, the `Inc. Damage Down` term and the incoming-block proc were each
 * fixed for, on the fourth channel. Pinned by the reflect direction arm in
 * `defenseSurvivabilitySim.test.ts`.
 *
 * WHY ONE FUNCTION AND NOT TWO. This shipped as `reflectedDamageForHit` plus a hand-copied
 * `reflectedDamagePreDefenceForHit` — the same five lines twice, with NOTHING tying the copies
 * together. A change to the model (a new term, a different clamp) would have had to be made in two
 * places by memory, and the compiler would not have said a word.
 */
export function reflectedDamageParts(args: {
    reflectPct: number;
    netHpDamage: number;
    affinityDamageModifier: number;
    /** calculateDamageReduction(attacker effective defence), range 0..~88 */
    attackerDefenceReductionPct: number;
    /** The bounce-back RECIPIENT's own incoming-reduction — victim-side. See the overload above. */
    attackerIncomingReductionPct: number;
}): { damage: number; preMitigation: number } {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return { damage: 0, preMitigation: 0 };
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const incoming = 1 - args.attackerIncomingReductionPct / 100;
    return {
        damage: Math.max(0, base * affinity * defence * incoming),
        // The identical product with an exact 1 in BOTH victim-side slots (defence and incoming) —
        // the same shape `victimHitDamageParts` uses, so neither axis is ever reconstructed by
        // division. `damage` above keeps its original operand order and its own locals, so it stays
        // byte-identical: no fitted constant moves.
        preMitigation: Math.max(0, base * affinity * 1 * 1),
    };
}
