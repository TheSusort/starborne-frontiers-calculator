import { EnemyBaseClass } from '../../types/calculator';
import { ConditionContext } from './evaluateConditions';

/**
 * Assemble a {@link ConditionContext} from per-round DPS-sim state.
 *
 * `enemyDebuffCount` uses ENTRY-ARRAY LENGTHS (active DoT entries / pending bombs),
 * NOT total stacks — matching the inline conditional/charge logic it replaces.
 * The remaining fields are DPS-assumption defaults: self HP is fixed at 100 (the sim
 * never takes damage); enemy HP is caller-derived (`enemyHpPct`, default 100);
 * no self-debuffs / enemy-buffs / adjacency.
 */
export function buildRoundContext(state: {
    selfBuffNames: string[];
    landedEnemyDebuffCount: number;
    corrosionEntryCount: number; // = corrosionEntries.length (active DoT entries, NOT total stacks)
    infernoEntryCount: number; // = infernoEntries.length
    bombCount: number; // = pendingBombs.length
    effectiveCritRate: number; // 0..100
    enemyType?: EnemyBaseClass;
    roundCrit?: boolean;
    /** Derived enemy HP% (0..100): 100 × max(0, 1 − cumulativeDamage/enemyHp). Default 100. */
    enemyHpPct?: number;
    /** Self HP% (0..100). Default 100 (DPS-assumption: self never takes damage). */
    selfHpPct?: number;
    /** Heal target's live HP% (0..100) for `hpSubject:'target'` gates. Default 100
     *  (DPS-assumption / no heal target → a "below N" target gate fails → inert). */
    targetHpPct?: number;
    /** Active buff names on the enemy. Default [] (DPS-assumption: no enemy buffs). */
    enemyBuffNames?: string[];
    /** Active debuff names on self. Default [] (DPS-assumption: no self-debuffs). */
    selfDebuffNames?: string[];
    /** Owner has the lowest Speed among its (player) team. Default true (lone-actor /
     *  DPS assumption: a single attacker is trivially the slowest). Populated live by the
     *  engine drain context (Phase 4c PR 6). */
    isLowestSpeedAlly?: boolean;
}): ConditionContext {
    return {
        selfBuffNames: state.selfBuffNames,
        enemyDebuffCount:
            state.landedEnemyDebuffCount +
            state.corrosionEntryCount +
            state.infernoEntryCount +
            state.bombCount,
        effectiveCritRate: state.effectiveCritRate,
        enemyType: state.enemyType,
        // DPS-assumption defaults (overridable for live-engine population)
        selfDebuffNames: state.selfDebuffNames ?? [],
        enemyBuffNames: state.enemyBuffNames ?? [],
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: state.selfHpPct ?? 100,
        targetHpPct: state.targetHpPct ?? 100,
        enemyHpPct: state.enemyHpPct ?? 100,
        isLowestSpeedAlly: state.isLowestSpeedAlly ?? true,
        ...(state.roundCrit !== undefined ? { roundCrit: state.roundCrit } : {}),
    };
}
