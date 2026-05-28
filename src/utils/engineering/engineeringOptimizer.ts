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
    /** Sum of % improvements across all starred ships of this role */
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
    // Tracks the actual starting level for each stat so the greedy can enforce ordering.
    const statStartLevels = new Map<string, number>();

    for (const [role, statNames] of Object.entries(ENGINEERING_STATS_BY_ROLE) as [
        BaseRoleName,
        StatName[],
    ][]) {
        const starredShips = ships.filter((s) => s.starred && getBaseRole(s.type) === role);

        if (starredShips.length === 0) continue;

        for (const statName of statNames) {
            // Find current stat value and derive starting level
            const roleStats = engineeringStats.stats.find((s) => s.shipType === role);
            const existingStat = roleStats?.stats.find((s) => s.name === statName);
            const currentValue = existingStat?.value ?? 0;
            const startLevel = isEngineeringFlatStat(statName) ? currentValue / 2 : currentValue;

            const key = `${role}-${statName}`;
            statStartLevels.set(key, startLevel);

            if (startLevel >= 20) continue;

            // Generate a candidate for every possible level transition from startLevel to 19.
            // Each level's improvement is computed relative to the simulated state after all
            // previous levels of this stat have been applied, so costs and baselines are exact.
            let simulatedEngStats = engineeringStats;

            for (let level = startLevel; level < 20; level++) {
                const tokenCost = getUpgradeCost(level);
                if (tokenCost <= 0) break;

                const increment = getStatIncrement(statName);
                const modifiedEngStats = withStatIncrement(
                    simulatedEngStats,
                    role,
                    statName,
                    increment
                );

                // Calculate percent improvement for each starred ship
                const shipBreakdown: ShipImprovement[] = [];
                for (const ship of starredShips) {
                    const baseEngStat = getEngStatForShip(simulatedEngStats, ship);
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

                const percentImprovement = shipBreakdown.reduce((sum, s) => sum + s.improvement, 0);

                if (!onlyImprovingUpgrades || percentImprovement > 0) {
                    const valueRatio = percentImprovement / tokenCost;
                    candidates.push({
                        role,
                        statName,
                        currentLevel: level,
                        nextLevel: level + 1,
                        tokenCost,
                        percentImprovement,
                        valueRatio,
                        shipBreakdown,
                    });
                }

                // Always advance the simulated state so the next level's baseline is correct.
                simulatedEngStats = modifiedEngStats;
            }
        }
    }

    // Sort by value ratio descending
    candidates.sort((a, b) => b.valueRatio - a.valueRatio);

    // Greedy budget allocation.
    // pickedNextLevel tracks the next level that must be picked for each stat, enforcing
    // that levels are bought in order (can't buy level 3→4 without first buying 2→3).
    const pickedNextLevel = new Map(statStartLevels);
    let remaining = budget;
    const recommendations: UpgradeRecommendation[] = [];
    let tokensUsed = 0;

    for (const candidate of candidates) {
        const key = `${candidate.role}-${candidate.statName}`;
        if (candidate.currentLevel !== pickedNextLevel.get(key)) continue;
        if (candidate.tokenCost > remaining) continue;

        recommendations.push(candidate);
        remaining -= candidate.tokenCost;
        tokensUsed += candidate.tokenCost;
        pickedNextLevel.set(key, candidate.nextLevel);
    }

    // Compute roleImprovements
    const roleImprovements: Partial<Record<BaseRoleName, number>> = {};
    for (const rec of recommendations) {
        roleImprovements[rec.role] = (roleImprovements[rec.role] ?? 0) + rec.percentImprovement;
    }

    return { recommendations, tokensUsed, roleImprovements };
}
