import { Ability, Condition } from '../../types/abilities';
import { EnemyBaseClass } from '../../types/calculator';

export interface ConditionContext {
    selfBuffNames: string[];
    selfDebuffNames: string[];
    enemyBuffNames: string[];
    enemyDebuffCount: number;
    enemyType?: EnemyBaseClass;
    effectiveCritRate: number; // 0..100
    /** This round's binary crit outcome from the deterministic schedule. When set,
     *  'self-crit' evaluates 1/0; when undefined (e.g. modifierCtx — see the two-tier
     *  note in the spec), it falls back to effectiveCritRate/100 as a probability. */
    roundCrit?: boolean;
    adjacentAllyCount: number;
    enemyAdjacentCount: number;
    enemyDestroyedCount: number;
    selfHpPct: number; // 0..100
    enemyHpPct: number; // 0..100
}

/** Resolve one condition to a count (>= 0). 0 means "not met". */
export function evaluateCondition(cond: Condition, ctx: ConditionContext): number {
    if (!cond.derivable) return Math.max(0, cond.manualCount ?? 1);

    switch (cond.subject) {
        case 'always':
            return 1;
        case 'self-buff':
            return countNames(ctx.selfBuffNames, cond.buffName);
        case 'self-debuff':
            return countNames(ctx.selfDebuffNames, cond.buffName);
        case 'enemy-buff':
            return countNames(ctx.enemyBuffNames, cond.buffName);
        case 'enemy-debuff':
            // Name-agnostic by design (mirrors dpsSimulator): counts ALL landed enemy
            // debuffs + DoTs, ignoring cond.buffName. A buffName on an enemy-debuff
            // condition is not a filter here — unlike self-buff/enemy-buff above.
            return ctx.enemyDebuffCount;
        case 'enemy-type': {
            if (!ctx.enemyType) return 0; // unknown type → cannot confirm either way
            const matches = ctx.enemyType === cond.requiredEnemyType;
            return (cond.negate ? !matches : matches) ? 1 : 0;
        }
        case 'self-crit':
            // Binary when the round's deterministic crit outcome is known; otherwise
            // the legacy probability (0..1) used as gate (>0) and expected-value scaler.
            if (ctx.roundCrit !== undefined) return ctx.roundCrit ? 1 : 0;
            return ctx.effectiveCritRate / 100;
        case 'adjacent-ally':
            return ctx.adjacentAllyCount;
        case 'enemy-adjacent':
            return ctx.enemyAdjacentCount;
        case 'enemy-destroyed':
            return ctx.enemyDestroyedCount;
        case 'hp-threshold':
            return evalHpThreshold(cond, ctx) ? 1 : 0;
        default:
            return 0;
    }
}

function countNames(names: string[], filter?: string): number {
    if (!filter) return names.length;
    return names.filter((n) => n === filter).length;
}

// HP-threshold basis: enemy HP by default (offensive scaling), or the unit's own HP when
// hpSubject is 'self' (e.g. "if at full HP"). Under DPS assumptions both are 100.
function evalHpThreshold(cond: Condition, ctx: ConditionContext): boolean {
    const hp = cond.hpSubject === 'self' ? ctx.selfHpPct : ctx.enemyHpPct;
    const t = cond.hpPercent ?? 0;
    return cond.hpComparator === 'above' ? hp > t : hp < t;
}

/**
 * Whether a single condition is satisfied (as a gate). With a `countComparator`,
 * the derived/manual count is compared against `countThreshold` (e.g. ≥3 debuffs,
 * exactly 0 debuffs); otherwise the default presence rule (count > 0) applies.
 */
export function conditionMet(cond: Condition, ctx: ConditionContext): boolean {
    const count = evaluateCondition(cond, ctx);
    if (cond.countComparator != null && cond.countThreshold != null) {
        switch (cond.countComparator) {
            case 'gte':
                return count >= cond.countThreshold;
            case 'lte':
                return count <= cond.countThreshold;
            case 'eq':
                return count === cond.countThreshold;
        }
    }
    return count > 0;
}

/** AND across OR-groups. Consecutive `anyOf` conditions form one OR-group. Empty → true. */
export function conditionsMet(conditions: Condition[], ctx: ConditionContext): boolean {
    if (conditions.length === 0) return true;
    const groups = groupConditions(conditions);
    return groups.every((group) => group.some((c) => conditionMet(c, ctx)));
}

/** Group runs of `anyOf` together; non-anyOf conditions are their own singleton groups. */
function groupConditions(conditions: Condition[]): Condition[][] {
    const groups: Condition[][] = [];
    let run: Condition[] = [];
    for (const c of conditions) {
        if (c.anyOf) {
            run.push(c);
        } else {
            if (run.length) {
                groups.push(run);
                run = [];
            }
            groups.push([c]);
        }
    }
    if (run.length) groups.push(run);
    return groups;
}

/** Per-count scaling bonus for an ability, capped. 0 if no scaling rule. */
export function scaledBonus(ability: Ability, ctx: ConditionContext): number {
    if (!ability.scaling) return 0;
    const c = ability.conditions[ability.scaling.conditionIndex];
    if (!c) return 0;
    const count = evaluateCondition(c, ctx);
    const bonus = count * ability.scaling.perUnit;
    return ability.scaling.cap != null ? Math.min(bonus, ability.scaling.cap) : bonus;
}
