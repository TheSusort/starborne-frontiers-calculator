import { Ability, OutgoingCondition, OutgoingHitContext } from '../../types/abilities';

/** True when an outgoing-amplification condition is satisfied by the hit context. */
function conditionMet(cond: OutgoingCondition, ctx: OutgoingHitContext): boolean {
    switch (cond) {
        case 'amplify-on-crit':
            return ctx.didCrit;
        case 'amplify-vs-higher-attack':
            return ctx.targetHigherAttack;
    }
}

/**
 * Summed amplification % for one in-flight direct hit (attacker side; mirror of
 * incomingReductionForHit). For each outgoing-amplification ability whose condition is met,
 * advance its proc gate via `rollProc(abilityId, procChance)`; on a firing gate, add `ampPct`.
 * Eligibility gates the gate — an ineligible hit never advances rollProc (matches "when
 * critically damaging" / "when directly damaging a higher-attack enemy"). Returns 0 when
 * nothing applies (no such equipment).
 */
export function outgoingAmplificationForHit(
    attackerAbilities: Ability[],
    ctx: OutgoingHitContext,
    rollProc: (abilityId: string, chance: number) => boolean
): number {
    let sum = 0;
    for (const a of attackerAbilities) {
        if (a.config.type !== 'outgoing-amplification') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        if (!rollProc(a.id, a.config.procChance)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}
