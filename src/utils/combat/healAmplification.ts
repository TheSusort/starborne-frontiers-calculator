import { Ability, HealAmpCondition, HealAmpContext } from '../../types/abilities';
import type { ShipRoleCategory } from '../../constants/shipTypes';

function conditionMet(cond: HealAmpCondition, ctx: HealAmpContext): boolean {
    switch (cond) {
        case 'target-hp-below-self':
            return ctx.targetHpPct < ctx.selfHpPct;
        case 'target-below-25':
            return ctx.targetHpPct < 25;
    }
}

/**
 * Summed heal-cast amplification % for one cast on one recipient (mirror of
 * outgoingAmplificationForHit). For each heal-amplification ability whose condition is met:
 * deterministic (no procChance) → always add ampPct; proc'd → add ampPct iff rollProc fires.
 * Eligibility gates the proc roll. Returns 0 when nothing applies (no such equipment).
 */
export function healAmplificationForCast(
    casterAbilities: Ability[],
    ctx: HealAmpContext,
    rollProc: (abilityId: string, chance: number) => boolean
): number {
    let sum = 0;
    for (const a of casterAbilities) {
        if (a.config.type !== 'heal-amplification') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        const pc = a.config.procChance;
        if (pc !== undefined && !rollProc(a.id, pc)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}

/**
 * Summed incoming-heal amplification % for ONE repair landing on a recipient (Exuberance; Madax's
 * "30% more repairs when adjacent to a supporter").
 *
 * For each incoming-heal-amplification ability the recipient carries: an ability gated on an
 * adjacent role counts only while `hasAdjacentRole` says a living ally of that role stands next to
 * the recipient right now; an ability with a `procChance` then adds `ampPct` iff its proc fires,
 * and one without it always adds. The adjacency gate is checked BEFORE the proc roll, so an
 * ineligible repair draws nothing. `rollProc` MUST be keyed by the recipient so all repairs the
 * unit receives share one combat-lifetime gate (single probability stream). Returns 0 when nothing
 * applies.
 */
export function incomingHealAmpForRecipient(
    recipientAbilities: Ability[],
    rollProc: (abilityId: string, chance: number) => boolean,
    hasAdjacentRole?: (role: ShipRoleCategory) => boolean
): number {
    let sum = 0;
    for (const a of recipientAbilities) {
        if (a.config.type !== 'incoming-heal-amplification') continue;
        const role = a.config.requiresAdjacentRole;
        if (role !== undefined && !(hasAdjacentRole?.(role) ?? false)) continue;
        const chance = a.config.procChance;
        if (chance !== undefined && !rollProc(a.id, chance)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}
