import { composeIncomingFactor, type IncomingReductionParts } from './victimDamage';

/**
 * Pure reflected ("thorns") damage calculator for the Reflect gear set and a ship's own
 * reflect (Nosorog).
 *
 * A reflector reflects a percentage of the hit AS THROWN: the attacker's per-hit raw damage
 * (`victimHitDamageParts(...).reflectBase`), before crit, the attacker's outgoing buffs,
 * affinity, defence or any incoming term. The bounce is then re-derived from the REFLECTOR's
 * side: its own Out. Damage Up, the affinity matchup, the original attacker's defence, and the
 * original attacker's own incoming reductions. This computes that raw reflected amount
 * **before shield absorb** — the engine seam applies shield, inside `applyVictimDamage`
 * (`engine.ts`).
 *
 *   reflected = pct% × reflectBase × (1 + reflectorOutgoing/100) × affinityFactor
 *               × (1 − defenceReduction/100)
 *               × composeIncomingFactor(statusChannel, recipientReductions)
 *
 * What the reflector took, its own shield and its own mitigation do not enter: the hit is
 * reflected whole. Measured (#678): Belladonna (attack 4598, defence 3647) hitting a 16%
 * Nosorog with a 140% active reflected 504 in game against ~509.3 from this model; every
 * measured fight sits at model × 0.9895, a constant the model does not carry. The affinity
 * term is kept but has not been measured.
 *
 * The last factor is the same capped composition a direct hit takes. Both bounces read the
 * attacker's incoming-damage status channel (Inc. Damage Up/Down); only a ship's reflect also reads
 * Exposed.
 *
 * Affinity argument order convention:
 *   The WEARER is the source of the reflected hit. Call
 *   `computeAffinityModifiers(wearer.affinity, attacker.affinity)`
 *   and pass `.damageModifier` as `affinityDamageModifier`.
 */
export function reflectedDamageForHit(args: {
    /** Reflect percentage, e.g. 10 for 10 % */
    reflectPct: number;
    /** The hit as thrown: `victimHitDamageParts(...).reflectBase`. */
    reflectBase: number;
    /** The REFLECTOR's outgoing damage buff (Out. Damage Up), signed %. Default 0. */
    reflectorOutgoingPct?: number;
    /** The REFLECTOR's separate outgoing factor (squad-leader outgoing bonus × Arcane Siege,
     *  `EffectiveOutgoingStats.outgoingSeparateFactor`). Default 1. */
    reflectorOutgoingSeparateFactor?: number;
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
    incomingDamageModifierPct?: number;
    victimSideIncomingPct?: number;
}): number {
    return reflectedDamageParts(args).damage;
}

/**
 * #358: BOTH axes of one reflected hit, from ONE evaluation — so the model cannot be changed on
 * one axis and left stale on the other.
 *
 *  • `damage`       — what the recipient takes: the full model above, every term intact.
 *  • `preMitigation` — the "damage absorbed" axis: the same hit with EVERY reduction that
 *    belongs to the recipient removed. Two terms go, both replaced by an exact 1:
 *    `attackerDefenceReductionPct` and `reflectVictimReduction`.
 *    The status channel loses only its victim-side slice (`victimSideIncomingPct`, the
 *    recipient's own Inc. Damage Down family), the same split `victimHitDamageParts` makes.
 *    What survives is the hit as THROWN — the reflect percentage, the reflector's outgoing buff
 *    and affinity, the thrown `reflectBase`, and attacker-applied amplification (Exposed).
 *
 * WHY `reflectVictimReduction` COMES OUT of `preMitigation`.
 * The model governs `damage` — the number the recipient's HP bar actually loses — and `damage`
 * keeps the term. `preMitigation` is not measured against anything; it already replaces the
 * defence term with a literal 1, so a recipient reduction has no claim to stay on that axis.
 * MEASURED, on a defender swinging 200% of 50,000 attack into a 50%-reflect enemy over 4 rounds:
 * `0% incoming-reduction -> 200,000 absorbed` · `30% -> 140,000` · `60% -> 80,000`, with IDENTICAL
 * round counts. Leaving it in makes a purely defensive passive quarter its owner's own headline
 * number — the same inversion the defence term, the `Inc. Damage Down` term and the
 * incoming-block proc each carried. Pinned by the reflect direction arm in
 * `defenseSurvivabilitySim.test.ts`.
 */
export function reflectedDamageParts(args: {
    reflectPct: number;
    /** The hit as thrown: `victimHitDamageParts(...).reflectBase`. */
    reflectBase: number;
    /** The REFLECTOR's outgoing damage buff (Out. Damage Up), signed %. Default 0. */
    reflectorOutgoingPct?: number;
    /** The REFLECTOR's separate outgoing factor (squad-leader outgoing bonus × Arcane Siege,
     *  `EffectiveOutgoingStats.outgoingSeparateFactor`). Default 1. */
    reflectorOutgoingSeparateFactor?: number;
    affinityDamageModifier: number;
    /** calculateDamageReduction(attacker effective defence), range 0..~88 */
    attackerDefenceReductionPct: number;
    /** The bounce-back RECIPIENT's own reductions — victim-side. See the overload above. */
    reflectVictimReduction: IncomingReductionParts;
    /**
     * The bounce-back recipient's incoming-damage STATUS channel
     * (`VictimDefenseProfile.incomingDamageModifierPct`): Inc. Damage Up/Down, Exposed and the
     * rest, signed (negative = takes less). Nosorog's bounce reads it like a counter (R176) and the
     * Reflect gear set's reads it without Exposed (R195). Default 0.
     */
    incomingDamageModifierPct?: number;
    /** The victim-side slice of that channel (`VictimDefenseProfile.victimSideIncomingPct`),
     *  which `preMitigation` strips while keeping the attacker-applied rest. Default 0. */
    victimSideIncomingPct?: number;
}): { damage: number; preMitigation: number; incomingFactor: number } {
    if (args.reflectPct <= 0 || args.reflectBase <= 0) {
        return { damage: 0, preMitigation: 0, incomingFactor: 1 };
    }
    const base = (args.reflectPct / 100) * args.reflectBase;
    const outgoing =
        (1 + (args.reflectorOutgoingPct ?? 0) / 100) * (args.reflectorOutgoingSeparateFactor ?? 1);
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const statusChannel = args.incomingDamageModifierPct ?? 0;
    const incoming = composeIncomingFactor(statusChannel, args.reflectVictimReduction);
    const statusAsThrown = 1 + (statusChannel - (args.victimSideIncomingPct ?? 0)) / 100;
    return {
        damage: Math.max(0, base * outgoing * affinity * defence * incoming),
        // The identical product with an exact 1 in BOTH victim-side slots (defence and incoming),
        // and the status channel losing only its victim-side slice (`statusAsThrown`) — the same
        // shape `victimHitDamageParts` uses, so no axis is ever reconstructed by division. `damage`
        // multiplies the composed, capped `incoming` factor; the exact-1 constants appear only
        // here.
        preMitigation: Math.max(0, base * outgoing * affinity * 1 * 1 * statusAsThrown),
        // The non-defence incoming factor in `damage` (`RedirectBasis.incomingFactor`).
        incomingFactor: incoming,
    };
}
