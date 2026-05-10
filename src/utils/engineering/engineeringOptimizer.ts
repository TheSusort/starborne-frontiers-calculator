import type { Ship } from '../../types/ship';
import type { EngineeringStats, EngineeringStat, StatName, Stat } from '../../types/stats';
import type { GearPiece } from '../../types/gear';
import type { ShipTypeName } from '../../constants/shipTypes';
import {
    ENGINEERING_STATS_BY_ROLE,
    getUpgradeCost,
    getStatIncrement,
    isEngineeringFlatStat,
    getBaseRole,
    type BaseRoleName,
} from '../../constants/engineeringStats';
import { calculateTotalStats } from '../ship/statsCalculator';
import { calculateRoleScore } from '../autogear/priorityScore';

export interface ShipImprovement {
    shipId: string;
    shipName: string;
    improvement: number;
}

export interface UpgradeRecommendation {
    role: BaseRoleName;
    statName: StatName;
    currentLevel: number;
    nextLevel: number;
    tokenCost: number;
    /** Average % improvement across starred ships of this role */
    percentImprovement: number;
    /** percentImprovement / tokenCost — used for ranking */
    valueRatio: number;
    /** Per-ship improvement breakdown */
    shipBreakdown: ShipImprovement[];
}

export interface OptimizationResult {
    /** Ordered list of recommended upgrades within the budget */
    recommendations: UpgradeRecommendation[];
    tokensUsed: number;
    /** Sum of percentImprovement per role across recommendations */
    roleImprovements: Partial<Record<BaseRoleName, number>>;
}

function getEngStatForShip(
    engineeringStats: EngineeringStats,
    ship: Ship
): EngineeringStat | undefined {
    const baseRole = getBaseRole(ship.type);
    return engineeringStats.stats.find((s) => s.shipType === baseRole);
}

function withStatIncrement(
    engineeringStats: EngineeringStats,
    role: BaseRoleName,
    statName: StatName,
    increment: number
): EngineeringStats {
    // Engineering flat stats (hacking, security) are FlexibleStats so FlatStat is safe.
    // All other engineering stats are percentage-based. Cast to Stat to satisfy the
    // discriminated union without widening the name type.
    const newStat = isEngineeringFlatStat(statName)
        ? ({ name: statName, value: increment, type: 'flat' } as Stat)
        : ({ name: statName, value: increment, type: 'percentage' } as Stat);

    const existingRole = engineeringStats.stats.find((s) => s.shipType === role);

    if (!existingRole) {
        return {
            stats: [...engineeringStats.stats, { shipType: role, stats: [newStat] }],
        };
    }

    return {
        stats: engineeringStats.stats.map((roleStats) => {
            if (roleStats.shipType !== role) return roleStats;
            const existingStat = roleStats.stats.find((s) => s.name === statName);
            if (existingStat) {
                return {
                    ...roleStats,
                    stats: roleStats.stats.map((s) =>
                        s.name === statName ? { ...s, value: s.value + increment } : s
                    ),
                };
            }
            return {
                ...roleStats,
                stats: [...roleStats.stats, newStat],
            };
        }),
    };
}

export function optimizeEngineering(
    budget: number,
    ships: Ship[],
    engineeringStats: EngineeringStats,
    getGearPiece: (id: string) => GearPiece | undefined,
    getShipRole?: (shipId: string) => ShipTypeName | null,
    onlyImprovingUpgrades?: boolean
): OptimizationResult {
    const candidates: UpgradeRecommendation[] = [];

    for (const [role, statNames] of Object.entries(ENGINEERING_STATS_BY_ROLE) as [
        BaseRoleName,
        StatName[],
    ][]) {
        const starredShips = ships.filter((s) => s.starred && getBaseRole(s.type) === role);

        if (starredShips.length === 0) continue;

        for (const statName of statNames) {
            // Find current stat value
            const roleStats = engineeringStats.stats.find((s) => s.shipType === role);
            const existingStat = roleStats?.stats.find((s) => s.name === statName);
            const currentValue = existingStat?.value ?? 0;

            // Derive current level
            const currentLevel = isEngineeringFlatStat(statName) ? currentValue / 2 : currentValue;

            if (currentLevel >= 20) continue;

            const tokenCost = getUpgradeCost(currentLevel);
            if (tokenCost <= 0) continue;

            const increment = getStatIncrement(statName);
            const modifiedEngStats = withStatIncrement(engineeringStats, role, statName, increment);

            // Calculate percent improvement for each starred ship
            const shipBreakdown: ShipImprovement[] = [];
            for (const ship of starredShips) {
                const baseEngStat = getEngStatForShip(engineeringStats, ship);
                const baseResult = calculateTotalStats(
                    ship.baseStats,
                    ship.equipment,
                    getGearPiece,
                    ship.refits ?? [],
                    ship.implants ?? {},
                    baseEngStat,
                    ship.id
                );
                const baseStats = baseResult.final;

                const modifiedEngStat = getEngStatForShip(modifiedEngStats, ship);
                const modifiedResult = calculateTotalStats(
                    ship.baseStats,
                    ship.equipment,
                    getGearPiece,
                    ship.refits ?? [],
                    ship.implants ?? {},
                    modifiedEngStat,
                    ship.id
                );
                const modifiedStats = modifiedResult.final;

                const scoreRole = getShipRole?.(ship.id) ?? ship.type;
                const baseScore = calculateRoleScore(scoreRole, baseStats);
                const newScore = calculateRoleScore(scoreRole, modifiedStats);
                // Note: DEFENDER_SECURITY and SUPPORTER_SHIELD multiply by `security`.
                // If security is 0 (typical for gear-less ships), baseScore is 0 and pct
                // falls through to 0 — the security track will appear valueless. In practice,
                // real ships have gear that provides security, so this rarely matters.
                const pct = baseScore > 0 ? ((newScore - baseScore) / baseScore) * 100 : 0;
                shipBreakdown.push({ shipId: ship.id, shipName: ship.name, improvement: pct });
            }

            const percentImprovement =
                shipBreakdown.length > 0
                    ? shipBreakdown.reduce((sum, s) => sum + s.improvement, 0) /
                      shipBreakdown.length
                    : 0;

            if (onlyImprovingUpgrades && percentImprovement <= 0) continue;

            const valueRatio = percentImprovement / tokenCost;

            candidates.push({
                role,
                statName,
                currentLevel,
                nextLevel: currentLevel + 1,
                tokenCost,
                percentImprovement,
                valueRatio,
                shipBreakdown,
            });
        }
    }

    // Sort by value ratio descending
    candidates.sort((a, b) => b.valueRatio - a.valueRatio);

    // Greedy budget allocation
    let remaining = budget;
    const recommendations: UpgradeRecommendation[] = [];
    let tokensUsed = 0;

    for (const candidate of candidates) {
        if (candidate.tokenCost <= remaining) {
            recommendations.push(candidate);
            remaining -= candidate.tokenCost;
            tokensUsed += candidate.tokenCost;
        }
    }

    // Compute roleImprovements
    const roleImprovements: Partial<Record<BaseRoleName, number>> = {};
    for (const rec of recommendations) {
        roleImprovements[rec.role] = (roleImprovements[rec.role] ?? 0) + rec.percentImprovement;
    }

    return { recommendations, tokensUsed, roleImprovements };
}
