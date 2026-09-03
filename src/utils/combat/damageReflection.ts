/**
 * Pure reflected ("thorns") damage calculator for the Reflect gear set.
 *
 * When a ship wearing Reflect takes a direct hit, it reflects a portion of the
 * damage back at the attacker. This module computes that raw reflected amount
 * **before shield absorb** — the engine seam applies shield, inside
 * `applyVictimDamage` (`engine.ts`).
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
     * Incoming-reduction % on the RECIPIENT of the bounce-back (default 0) — i.e. the ship that
     * threw the original hit and is now the VICTIM of the thorns. The incoming-reduction channel, resolved at
     * `engine.ts` as `incomingReductionForHit(incomingAbilitiesOf(attacker.id), …)`.
     *
     * ⚠️ DO NOT RENAME THIS TO `attackerIncomingReductionPct`. "attacker" reads as POSITIONAL
     * here (who threw the original hit) where a reader takes it as CAUSAL (attacker-side, and
     * therefore not a victim-side reduction to strip).
     * The distinction is not cosmetic — `attackerSideReductionPct` in `victimDamage.ts`, ONE call
     * away, is where "attacker" genuinely IS causal (the attacker's own squad-leader penalty). Two
     * adjacent parameters with the same prefix and opposite meanings is exactly the shape that
     * produces this defect, so the positional one does not carry the prefix.
     * (`attackerDefenceReductionPct` below is positional in the same way and keeps its name only
     * because it names a stat OF that ship rather than a side; read it as "the bounce-back
     * recipient's own defence".)
     */
    reflectVictimIncomingReductionPct: number;
}): number {
    return reflectedDamageParts(args).damage;
}

/**
 * #358: BOTH axes of one reflected hit, from ONE evaluation — so the model cannot be changed on
 * one axis and left stale on the other.
 *
 *  • `damage`       — what the recipient takes: the full empirical model above, every term intact.
 *  • `preMitigation` — the "damage absorbed" axis: the same hit with EVERY reduction that
 *    belongs to the recipient removed. Two terms go, both replaced by an exact 1:
 *    `attackerDefenceReductionPct` and `reflectVictimIncomingReductionPct`.
 *    What survives is the hit as THROWN — the reflect percentage, the reflector's affinity, and
 *    the `netHpDamage` the reflector actually took.
 *
 * WHY `reflectVictimIncomingReductionPct` COMES OUT of `preMitigation`.
 * The duel-fit model governs `damage` — the number the recipient's HP bar actually loses — and
 * `damage` keeps the term. `preMitigation` is not a fit to anything; it is by construction a
 * DEPARTURE from the fit, since it already replaces the fitted defence term with a literal 1. A
 * term cannot be defended as load-bearing for an empirical constant on an axis that no constant is
 * fitted against.
 * MEASURED, on a defender swinging 200% of 50,000 attack into a 50%-reflect enemy over 4 rounds:
 * `0% incoming-reduction -> 200,000 absorbed` · `30% -> 140,000` · `60% -> 80,000`, with IDENTICAL
 * round counts. Leaving it in makes a purely defensive passive quarter its owner's own headline
 * number — the same inversion the defence term, the `Inc. Damage Down` term and the
 * incoming-block proc each carried. Pinned by the reflect direction arm in
 * `defenseSurvivabilitySim.test.ts`.
 */
export function reflectedDamageParts(args: {
    reflectPct: number;
    netHpDamage: number;
    affinityDamageModifier: number;
    /** calculateDamageReduction(attacker effective defence), range 0..~88 */
    attackerDefenceReductionPct: number;
    /** The bounce-back RECIPIENT's own incoming-reduction — victim-side. See the overload above. */
    reflectVictimIncomingReductionPct: number;
}): { damage: number; preMitigation: number } {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return { damage: 0, preMitigation: 0 };
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const incoming = 1 - args.reflectVictimIncomingReductionPct / 100;
    return {
        damage: Math.max(0, base * affinity * defence * incoming),
        // The identical product with an exact 1 in BOTH victim-side slots (defence and incoming) —
        // the same shape `victimHitDamageParts` uses, so neither axis is ever reconstructed by
        // division. `damage` above keeps its own operand order and its own locals: the exact-1
        // constants appear only here, never folded into the mitigated product.
        preMitigation: Math.max(0, base * affinity * 1 * 1),
    };
}
