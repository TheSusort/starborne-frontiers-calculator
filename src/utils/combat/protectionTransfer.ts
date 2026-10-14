/**
 * Pure Protection damage-transfer cascade.
 *
 * For ONE direct hit that landed `fullTargetDamage` on a target (already including the
 * target's affinity, outgoing buffs, DEFENSE mitigation `targetMit` and non-defence incoming
 * factor `targetIncomingFactor`), compute how much the target keeps and how much each protector
 * absorbs.
 *
 * Each ship prices its OWN part of the hit with its OWN victim-side factors (owner-measured
 * 2026-10-14, `protectionOwnReductions.integration.test.ts`). The cascade works in P-space,
 * P = fullTargetDamage / (targetMit × targetIncomingFactor): the hit with the target's affinity and
 * the attacker's outgoing factors intact and every target-side reduction peeled off. Each
 * protector's chunk is then priced on that protector's own defence (`mit`) and incoming
 * composition (`incomingFactor`). The target keeps (1 − frac₁) of `fullTargetDamage` unchanged.
 *
 * Multi-protector = speed-ordered CASCADE: protector i skims fracᵢ of protector (i-1)'s
 * inflow, not of the original hit. The original target loses only the first hop.
 */
export interface ProtectorInput {
    /** Protector's defence damage-through factor (1 - reduction/100), in (0,1]. */
    mit: number;
    /** Protector's own non-defence incoming factor (`composeIncomingFactor`). Absent → 1, for a
     *  hit kind that reads no incoming composition on either ship (bombs, bursts). */
    incomingFactor?: number;
    /** Protection stacks on this protector (>= 1). */
    stacks: number;
}

/**
 * What a caller folded into a direct hit on its target, handed to the funnel so the Protection
 * cascade divides by exactly the factors that were applied and prices each protector's chunk on
 * the same kind of hit. Never re-derived downstream.
 */
export interface RedirectBasis {
    /** The target's defence factor in the hit (`victimDefenceMitigation`). */
    defenceMitigation: number;
    /** The target's non-defence incoming factor in the hit (`composeIncomingFactor`). */
    incomingFactor: number;
    /** The hit's crit outcome — the protector's crit-only reductions read it. */
    didCrit: boolean;
}

export interface ProtectionChunk {
    stacks: number;
    perStack: number;
    total: number;
    /** #358 ADDENDUM 2: this chunk BEFORE the protector's own reductions (`mit`,
     *  `incomingFactor`), i.e. the raw amount thrown at the protector. Read straight off the
     *  P-space inflow — no division. */
    perStackPreMitigation: number;
}

export interface CascadeResult {
    targetRemainder: number;
    /** #358 ADDENDUM 2: the fraction of the ORIGINAL hit the target keeps (`1 - frac1`). The
     *  caller scales its own pre-defence figure by this instead of dividing `targetRemainder`. */
    targetRetainedFraction: number;
    chunks: ProtectionChunk[];
}

const fracFor = (stacks: number): number => Math.min(1, 0.1 * stacks);

export function protectionCascade(
    fullTargetDamage: number,
    targetMit: number,
    protectors: ProtectorInput[],
    targetIncomingFactor = 1
): CascadeResult {
    const targetThrough = targetMit * targetIncomingFactor;
    if (protectors.length === 0 || targetThrough <= 0 || fullTargetDamage <= 0) {
        return { targetRemainder: fullTargetDamage, targetRetainedFraction: 1, chunks: [] };
    }

    const P = fullTargetDamage / targetThrough; // the hit before every target-side reduction
    const frac1 = fracFor(protectors[0].stacks);
    const targetRemainder = (1 - frac1) * fullTargetDamage;

    const chunks: ProtectionChunk[] = [];
    let flow = frac1 * P; // P-space inflow to the current protector
    for (let i = 0; i < protectors.length; i++) {
        const nextFrac = i + 1 < protectors.length ? fracFor(protectors[i + 1].stacks) : 0;
        const keptPreMit = (1 - nextFrac) * flow; // P-space: before the protector's reductions
        // This protector's HP damage: its own defence and its own incoming composition.
        const kept = keptPreMit * protectors[i].mit * (protectors[i].incomingFactor ?? 1);
        chunks.push({
            stacks: protectors[i].stacks,
            perStack: kept / protectors[i].stacks,
            total: kept,
            perStackPreMitigation: keptPreMit / protectors[i].stacks,
        });
        flow = nextFrac * flow; // pass the remainder to the next protector
    }
    return { targetRemainder, targetRetainedFraction: 1 - frac1, chunks };
}

export function protectionStacks(activeSelfBuffs: { buffName: string; stacks?: number }[]): number {
    return activeSelfBuffs
        .filter((b) => b.buffName === 'Protection')
        .reduce((sum, b) => sum + (b.stacks ?? 1), 0);
}
