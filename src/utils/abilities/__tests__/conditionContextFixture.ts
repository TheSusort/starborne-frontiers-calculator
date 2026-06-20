import { ConditionContext } from '../evaluateConditions';

/**
 * Test fixture: a ConditionContext with all required fields defaulted, plus overrides.
 * Single source of truth so a new ConditionContext field is updated in ONE place.
 *
 * Optional fields (enemyType, roundCrit, targetHpPct, isLowestSpeedAlly,
 * targetRepairedThisRound, selfShielded) are NOT defaulted here — TypeScript optional
 * fields are undefined by default, which is the correct baseline for tests that do not
 * exercise those paths. Pass them via `over` when a test depends on them.
 */
export function makeConditionContext(over: Partial<ConditionContext> = {}): ConditionContext {
    return {
        selfBuffNames: [],
        selfDebuffNames: [],
        enemyBuffNames: [],
        enemyDebuffCount: 0,
        effectiveCritRate: 0,
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: 100,
        enemyHpPct: 100,
        ...over,
    };
}
