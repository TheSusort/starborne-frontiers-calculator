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
    /** Incoming-reduction % on the attacker (default 0) */
    attackerIncomingReductionPct: number;
}): number {
    return reflectedDamageParts(args).damage;
}

/**
 * #358 ADDENDUM 2/3: BOTH axes of one reflected hit, from ONE evaluation.
 *
 *  • `damage`       — what the recipient takes: the full empirical model above.
 *  • `preMitigation` — the same hit with the RECIPIENT's own defence term replaced by an exact 1.
 *    That is the "damage absorbed" axis (C2): the recipient's defence is a victim-side reduction
 *    and comes out, while the reflector's affinity and the reflect percentage are the hit as
 *    thrown and stay in.
 *
 * WHY ONE FUNCTION AND NOT TWO. This shipped as `reflectedDamageForHit` plus a hand-copied
 * `reflectedDamagePreDefenceForHit` — the same five lines twice, with NOTHING tying the copies
 * together. A change to the model (a new term, a different clamp) would have had to be made in two
 * places by memory, and the compiler would not have said a word. `attackerIncomingReductionPct`
 * is deliberately folded into BOTH: it is a reduction on the RECIPIENT of the bounce-back, and
 * stripping it here is a separate, unmade decision (this module's own duel-fit model owns it).
 */
export function reflectedDamageParts(args: {
    reflectPct: number;
    netHpDamage: number;
    affinityDamageModifier: number;
    /** calculateDamageReduction(attacker effective defence), range 0..~88 */
    attackerDefenceReductionPct: number;
    attackerIncomingReductionPct: number;
}): { damage: number; preMitigation: number } {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return { damage: 0, preMitigation: 0 };
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const incoming = 1 - args.attackerIncomingReductionPct / 100;
    return {
        damage: Math.max(0, base * affinity * defence * incoming),
        // The identical product with an exact 1 in the defence slot — the same shape
        // `victimHitDamageParts` uses, so neither axis is ever reconstructed by division.
        preMitigation: Math.max(0, base * affinity * 1 * incoming),
    };
}
