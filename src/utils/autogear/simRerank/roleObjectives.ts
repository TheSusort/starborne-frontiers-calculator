import { matchesRoleCategory, type ShipTypeName } from '../../../constants/shipTypes';

/** Metrics a tuning run scores on. Distinct from `SimMetric` in `metricTable.ts`: these are
 *  ROLE OBJECTIVES, several of which need round-state fields `ActorTotals` does not carry. */
export type ObjectiveMetric =
    'focusDamageDealt' | 'focusDamageTakenShare' | 'focusSupportOutput' | 'enemyDebuffUptime';

export interface RoleObjective {
    /** The metric the role is trying to grow. */
    maximise: ObjectiveMetric;
    /** What must not get worse. Every single-metric maximiser picks a corner — a build that
     *  dumps everything in two rounds and dies scores best on damage alone. */
    constraint: 'winRate' | 'survival';
}

export function roleObjective(role: ShipTypeName): RoleObjective {
    if (matchesRoleCategory(role, ['DEFENDER'])) {
        return { maximise: 'focusDamageTakenShare', constraint: 'survival' };
    }
    if (matchesRoleCategory(role, ['SUPPORTER'])) {
        return { maximise: 'focusSupportOutput', constraint: 'survival' };
    }
    if (matchesRoleCategory(role, ['DEBUFFER'])) {
        return { maximise: 'enemyDebuffUptime', constraint: 'winRate' };
    }
    return { maximise: 'focusDamageDealt', constraint: 'winRate' };
}
