import { composeIncomingFactor, type IncomingReductionParts } from './victimDamage';

/**
 * Pure reflected ("thorns") damage calculator for the Reflect gear set and a ship's own
 * reflect (Nosorog).
 *
 * When a reflector takes a direct hit, it reflects a portion of the damage back at the attacker.
 * This module computes that raw reflected amount **before shield absorb** — the engine seam
 * applies shield, inside `applyVictimDamage` (`engine.ts`).
 *
 * Empirically-validated model (two in-game duels):
 *   reflected = pct% × netHpDamage × affinityFactor
 *               × (1 − defenceReduction/100)
 *               × composeIncomingFactor(statusChannel, recipientReductions)
 *
 * The last factor is the same capped composition a direct hit takes. A ship's reflect also reads
 * the attacker's incoming-damage status channel (R176); the gear set's bounce leaves it at 0.
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
     * The RECIPIENT's reductions against the bounce-back — i.e. the ship that threw the original
     * hit and is now the VICTIM of the thorns (`hitReductionFor(reflector, recipient).parts` at
     * `engine.ts`). Composed with the status channel exactly as any direct hit is, and capped:
     * read `composeIncomingFactor`.
     *
     * Named for the recipient, not "attacker": `attackerCritPenaltyPct` in `victimDamage.ts` is
     * causal-attacker, and a shared prefix with the opposite meaning invites mixing them up.
     */
    reflectVictimReduction: IncomingReductionParts;
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
 *    `attackerDefenceReductionPct` and `reflectVictimReduction`.
 *    The status channel loses only its victim-side slice (`victimSideIncomingPct`, the
 *    recipient's own Inc. Damage Down family), the same split `victimHitDamageParts` makes.
 *    What survives is the hit as THROWN — the reflect percentage, the reflector's affinity, the
 *    `netHpDamage` the reflector actually took, and attacker-applied amplification (Exposed).
 *
 * WHY `reflectVictimReduction` COMES OUT of `preMitigation`.
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
    /** The bounce-back RECIPIENT's own reductions — victim-side. See the overload above. */
    reflectVictimReduction: IncomingReductionParts;
    /**
     * The bounce-back recipient's incoming-damage STATUS channel
     * (`VictimDefenseProfile.incomingDamageModifierPct`): Inc. Damage Up/Down, Exposed and the
     * rest, signed (negative = takes less). Nosorog's bounce reads it like a counter (R176); the
     * Reflect gear set's leaves it at the default 0.
     */
    incomingDamageModifierPct?: number;
    /** The victim-side slice of that channel (`VictimDefenseProfile.victimSideIncomingPct`),
     *  which `preMitigation` strips while keeping the attacker-applied rest. Default 0. */
    victimSideIncomingPct?: number;
}): { damage: number; preMitigation: number } {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return { damage: 0, preMitigation: 0 };
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const statusChannel = args.incomingDamageModifierPct ?? 0;
    const incoming = composeIncomingFactor(statusChannel, args.reflectVictimReduction);
    const statusAsThrown = 1 + (statusChannel - (args.victimSideIncomingPct ?? 0)) / 100;
    return {
        damage: Math.max(0, base * affinity * defence * incoming),
        // The identical product with an exact 1 in BOTH victim-side slots (defence and incoming),
        // and the status channel losing only its victim-side slice (`statusAsThrown`) — the same
        // shape `victimHitDamageParts` uses, so no axis is ever reconstructed by division. `damage`
        // multiplies the composed, capped `incoming` factor; the exact-1 constants appear only
        // here.
        preMitigation: Math.max(0, base * affinity * 1 * 1 * statusAsThrown),
    };
}
