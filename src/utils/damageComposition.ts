/**
 * Dependency-free composition of a victim's non-defence incoming damage reductions. A leaf module:
 * it imports nothing from the app, so combat and autogear can both use it without an import cycle
 * (`combat/victimDamage` imports from `autogear/priorityScore`).
 */

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
