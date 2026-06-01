import { EnemyBaseClass } from '../../types/calculator';
import { ConditionContext } from './evaluateConditions';

/**
 * Assemble a {@link ConditionContext} from per-round DPS-sim state.
 *
 * `enemyDebuffCount` uses ENTRY-ARRAY LENGTHS (active DoT entries / pending bombs),
 * NOT total stacks — matching the inline conditional/charge logic it replaces.
 * The remaining fields are DPS-assumption defaults (single target at full HP,
 * no self-debuffs / enemy-buffs / adjacency).
 */
export function buildRoundContext(state: {
    selfBuffNames: string[];
    landedEnemyDebuffCount: number;
    corrosionEntryCount: number; // = corrosionEntries.length (active DoT entries, NOT total stacks)
    infernoEntryCount: number; // = infernoEntries.length
    bombCount: number; // = pendingBombs.length
    effectiveCritRate: number; // 0..100
    enemyType?: EnemyBaseClass;
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
        // DPS-assumption defaults
        selfDebuffNames: [],
        enemyBuffNames: [],
        adjacentAllyCount: 0,
        enemyAdjacentCount: 0,
        enemyDestroyedCount: 0,
        selfHpPct: 100,
        enemyHpPct: 100,
    };
}
