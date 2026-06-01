import { Ability, Condition } from '../../types/abilities';
import { EnemyBaseClass } from '../../types/calculator';

export interface ConditionContext {
    selfBuffNames: string[];
    selfDebuffNames: string[];
    enemyBuffNames: string[];
    enemyDebuffCount: number;
    enemyType?: EnemyBaseClass;
    effectiveCritRate: number; // 0..100
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
            return ctx.enemyDebuffCount;
        case 'enemy-type':
            return ctx.enemyType && ctx.enemyType === cond.requiredEnemyType ? 1 : 0;
        case 'self-crit':
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

// HP-threshold basis: enemy HP for offensive scaling. Under DPS assumptions both are 100.
function evalHpThreshold(cond: Condition, ctx: ConditionContext): boolean {
    const hp = ctx.enemyHpPct;
    const t = cond.hpPercent ?? 0;
    return cond.hpComparator === 'above' ? hp > t : hp < t;
}

/** AND across OR-groups. Consecutive `anyOf` conditions form one OR-group. Empty → true. */
export function conditionsMet(conditions: Condition[], ctx: ConditionContext): boolean {
    if (conditions.length === 0) return true;
    const groups = groupConditions(conditions);
    return groups.every((group) => group.some((c) => evaluateCondition(c, ctx) > 0));
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
