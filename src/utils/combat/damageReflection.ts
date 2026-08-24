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
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return 0;
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const incoming = 1 - args.attackerIncomingReductionPct / 100;
    return Math.max(0, base * affinity * defence * incoming);
}

/** #358 ADDENDUM 2: the same reflected hit WITHOUT the reflect victim's (i.e. the original
 *  attacker's) defence term — the raw amount thrown at it. Same expression with an exact 1 in the
 *  defence slot, so the mitigated sibling above stays byte-identical. */
export function reflectedDamagePreDefenceForHit(args: {
    reflectPct: number;
    netHpDamage: number;
    affinityDamageModifier: number;
    attackerIncomingReductionPct: number;
}): number {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return 0;
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const incoming = 1 - args.attackerIncomingReductionPct / 100;
    return Math.max(0, base * affinity * 1 * incoming);
}
