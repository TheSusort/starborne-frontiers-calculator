/**
 * Pure Protection damage-transfer cascade.
 *
 * For ONE direct hit that landed `fullTargetDamage` on a target (already including the
 * target's affinity, outgoing buffs, and DEFENSE mitigation `targetMit`), compute how much
 * the target keeps and how much each protector absorbs.
 *
 * Working in P-space (P = pre-target-defense damage = fullTargetDamage / targetMit) keeps
 * the affinity + outgoing factors that are baked into `fullTargetDamage` intact for every
 * protector chunk — only the DEFENSE factor is swapped (mitᵢ vs targetMit). That is the
 * empirically-confirmed rule: the redirect keeps the ORIGINAL TARGET's affinity, and
 * re-mitigates on the PROTECTOR's own defense.
 *
 * Multi-protector = speed-ordered CASCADE: protector i skims fracᵢ of protector (i-1)'s
 * inflow, not of the original hit. The original target loses only the first hop.
 */
export interface ProtectorInput {
    /** Protector's damage-through factor (1 - reduction/100), in (0,1]. */
    mit: number;
    /** Protection stacks on this protector (>= 1). */
    stacks: number;
}

export interface ProtectionChunk {
    stacks: number;
    perStack: number;
    total: number;
    /** #358 ADDENDUM 2: this chunk BEFORE the protector's own defence term (`mit`), i.e. the raw
     *  amount thrown at the protector. Read straight off the P-space inflow — no division. */
    perStackPreMitigation: number;
    totalPreMitigation: number;
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
    protectors: ProtectorInput[]
): CascadeResult {
    if (protectors.length === 0 || targetMit <= 0 || fullTargetDamage <= 0) {
        return { targetRemainder: fullTargetDamage, targetRetainedFraction: 1, chunks: [] };
    }

    const P = fullTargetDamage / targetMit; // pre-target-defense damage
    const frac1 = fracFor(protectors[0].stacks);
    const targetRemainder = (1 - frac1) * fullTargetDamage;

    const chunks: ProtectionChunk[] = [];
    let flow = frac1 * P; // P-space inflow to the current protector
    for (let i = 0; i < protectors.length; i++) {
        const nextFrac = i + 1 < protectors.length ? fracFor(protectors[i + 1].stacks) : 0;
        const keptPreMit = (1 - nextFrac) * flow; // P-space: pre-protector-defence
        const kept = (1 - nextFrac) * flow * protectors[i].mit; // this protector's HP damage
        chunks.push({
            stacks: protectors[i].stacks,
            perStack: kept / protectors[i].stacks,
            total: kept,
            perStackPreMitigation: keptPreMit / protectors[i].stacks,
            totalPreMitigation: keptPreMit,
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
