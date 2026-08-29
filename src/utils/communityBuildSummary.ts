import { SHIP_TYPES } from '../constants/shipTypes';
import { GEAR_SETS } from '../constants/gearSets';
import { IMPLANTS } from '../constants/implants';
import { STATS, getLimitStatLabel } from '../constants/stats';
import type { StatName } from '../types/stats';
import type { SharedAutogearBuild } from '../types/communityRecommendation';

// Every lookup below is keyed by community-authored data, so every one falls
// back to the raw key rather than indexing a Record and trusting the result.
const setLabel = (setName: string): string =>
    GEAR_SETS[setName]?.name ?? IMPLANTS[setName]?.name ?? setName;

/**
 * One-line config summary for a collapsed community build row, in the same
 * style as the per-ship summary in AutogearConfigList.
 *
 * e.g. "Attacker · 4x Critical, 2x Power · Crit Rate min 100 · Attack 30% additive"
 */
export const communityBuildSummary = (build: SharedAutogearBuild): string => {
    const parts: string[] = [];

    parts.push(SHIP_TYPES[build.shipRole]?.name ?? build.shipRole);

    if (build.setPriorities.length > 0) {
        parts.push(
            build.setPriorities
                .map((set) =>
                    set.kind === 'implant'
                        ? setLabel(set.setName)
                        : `${set.count}x ${setLabel(set.setName)}`
                )
                .join(', ')
        );
    }

    // Only limit-carrying priorities say anything in one line; an unlimited
    // priority's strength is its position in the list, which a summary can't show.
    const limits = build.statPriorities
        .filter((priority) => priority.minLimit !== undefined || priority.maxLimit !== undefined)
        .map((priority) => {
            const bounds: string[] = [];
            if (priority.minLimit !== undefined) bounds.push(`min ${priority.minLimit}`);
            if (priority.maxLimit !== undefined) bounds.push(`max ${priority.maxLimit}`);
            return `${getLimitStatLabel(priority.stat)} ${bounds.join(' ')}`;
        });
    if (limits.length > 0) parts.push(limits.join(', '));

    if (build.statBonuses.length > 0) {
        parts.push(
            build.statBonuses
                .map(
                    (bonus) =>
                        `${STATS[bonus.stat as StatName]?.label ?? bonus.stat} ${bonus.percentage}% ${
                            bonus.mode === 'multiplier' ? 'multiplier' : 'additive'
                        }`
                )
                .join(', ')
        );
    }

    return parts.join(' · ');
};
