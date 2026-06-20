import { Ability, IncomingCondition, IncomingHitContext } from '../../types/abilities';

/** True when an incoming condition is satisfied by the hit context. */
function conditionMet(cond: IncomingCondition, ctx: IncomingHitContext): boolean {
    switch (cond) {
        case 'self-stealth':
            return ctx.victimStealthed;
        case 'self-stasis':
            return ctx.victimStasised;
        case 'incoming-crit':
            return ctx.didCrit;
        case 'incoming-crit-by-stealthed':
            return ctx.didCrit && ctx.attackerStealthed;
        case 'nth-hit-2plus':
            return ctx.hitIndexThisRound >= 2;
        case 'dot-inferno-corrosion':
            return ctx.dotType === 'inferno' || ctx.dotType === 'corrosion';
    }
}

/**
 * Total incoming %-reduction for one hit (D-PR3 composition):
 *   max(applicable crit-family entries) + sum(applicable non-crit-family entries).
 * `scope` must match the hit: 'dot' entries apply only when ctx.dotType is set; 'direct'
 * entries only when it is not. Returns 0 when nothing applies.
 */
export function incomingReductionForHit(
    victimAbilities: Ability[],
    ctx: IncomingHitContext
): number {
    const isDot = ctx.dotType !== undefined;
    let nonCritSum = 0;
    let critFamilyMax = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-reduction') continue;
        const { scope, condition, pct, critFamily } = a.config;
        if ((scope === 'dot') !== isDot) continue;
        if (!conditionMet(condition, ctx)) continue;
        if (critFamily) critFamilyMax = Math.max(critFamilyMax, pct);
        else nonCritSum += pct;
    }
    return nonCritSum + critFamilyMax;
}

/**
 * Blocked fraction (0..1) for one DIRECT-damage intake. Full block (blockPct 1.0)
 * supersedes any partial block. `rollBlock(abilityId, chance)` is the engine-supplied
 * deterministic gate (true = proc). Returns 0 when nothing blocks. The once-per-round
 * guard is enforced by the ENGINE wrapper inside rollBlock; this function stays pure.
 */
export function incomingBlockForIntake(
    victimAbilities: Ability[],
    ctx: IncomingHitContext,
    rollBlock: (abilityId: string, chance: number) => boolean
): number {
    let best = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-block') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        if (!rollBlock(a.id, a.config.procChance)) continue;
        best = Math.max(best, a.config.blockPct);
        if (best >= 1) return 1;
    }
    return best;
}
