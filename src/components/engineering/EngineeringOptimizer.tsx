import React, { useState, useMemo, useCallback } from 'react';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { Button, Input, StatCard, Checkbox } from '../ui';
import {
    optimizeEngineering,
    type OptimizationResult,
    type ShipImprovement,
} from '../../utils/engineering/engineeringOptimizer';
import { getBaseRole, type BaseRoleName } from '../../constants/engineeringStats';
import type { StatName } from '../../types/stats';
import { STATS } from '../../constants/stats';

const ROLE_LABELS: Record<BaseRoleName, string> = {
    ATTACKER: 'Attacker',
    DEFENDER: 'Defender',
    DEBUFFER: 'Debuffer',
    SUPPORTER: 'Supporter',
};

interface GroupedRecommendation {
    role: BaseRoleName;
    statName: StatName;
    fromLevel: number;
    toLevel: number;
    totalTokenCost: number;
    totalImprovement: number;
    /** Ship breakdown from the first level in this group */
    shipBreakdown: ShipImprovement[];
}

function groupRecommendations(result: OptimizationResult): GroupedRecommendation[] {
    const map = new Map<string, GroupedRecommendation>();
    for (const rec of result.recommendations) {
        const key = `${rec.role}-${rec.statName}`;
        const existing = map.get(key);
        if (existing) {
            existing.toLevel = rec.nextLevel;
            existing.totalTokenCost += rec.tokenCost;
            existing.totalImprovement += rec.percentImprovement;
            // Accumulate per-ship improvements across all levels in the group
            for (const shipImp of rec.shipBreakdown) {
                const entry = existing.shipBreakdown.find((s) => s.shipId === shipImp.shipId);
                if (entry) entry.improvement += shipImp.improvement;
            }
        } else {
            map.set(key, {
                role: rec.role,
                statName: rec.statName,
                fromLevel: rec.currentLevel,
                toLevel: rec.nextLevel,
                totalTokenCost: rec.tokenCost,
                totalImprovement: rec.percentImprovement,
                shipBreakdown: rec.shipBreakdown.map((s) => ({ ...s })),
            });
        }
    }
    return Array.from(map.values()).sort(
        (a, b) => b.totalImprovement / b.totalTokenCost - a.totalImprovement / a.totalTokenCost
    );
}

interface RecommendationRowProps {
    rec: GroupedRecommendation;
    rank: number;
}

const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec, rank }) => {
    const benefiting = rec.shipBreakdown.filter((s) => s.improvement > 0);
    const levelsUpgraded = rec.toLevel - rec.fromLevel;
    return (
        <div className="card">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className="text-theme-text-secondary font-mono text-sm shrink-0">
                        #{rank}
                    </span>
                    <div>
                        <div className="font-medium text-sm">
                            {ROLE_LABELS[rec.role]} &middot;{' '}
                            {STATS[rec.statName]?.label ?? rec.statName}
                        </div>
                        <div className="text-xs text-theme-text-secondary mt-0.5">
                            Level {rec.fromLevel} &rarr; {rec.toLevel}
                            {levelsUpgraded > 1 && ` (${levelsUpgraded} upgrades)`}
                            {' · '}
                            {rec.totalTokenCost.toLocaleString()} tokens
                        </div>
                        {benefiting.length > 0 && (
                            <div className="text-xs text-theme-text-secondary mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                {benefiting.map((s) => (
                                    <span key={s.shipId}>
                                        {s.shipName}{' '}
                                        <span className="text-green-400">
                                            +{s.improvement.toFixed(2)}%
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <span className="text-green-400 font-semibold text-sm shrink-0">
                    +{rec.totalImprovement.toFixed(2)}%
                </span>
            </div>
        </div>
    );
};

export const EngineeringOptimizer: React.FC = () => {
    const { ships } = useShips();
    const { getGearPiece } = useInventory();
    const { engineeringStats } = useEngineeringStats();
    const { getConfig } = useAutogearConfig();

    const [tokenBudget, setTokenBudget] = useState<number>(10000);
    const [onlyImprovingUpgrades, setOnlyImprovingUpgrades] = useState(true);
    const [result, setResult] = useState<OptimizationResult | null>(null);

    const starredCountByRole = useMemo(() => {
        const counts: Partial<Record<BaseRoleName, number>> = {};
        for (const ship of ships) {
            if (!ship.starred) continue;
            const role = getBaseRole(ship.type);
            counts[role] = (counts[role] ?? 0) + 1;
        }
        return counts;
    }, [ships]);

    const totalStarredShips = Object.values(starredCountByRole).reduce(
        (sum, count) => sum + (count ?? 0),
        0
    );
    const isDisabled = totalStarredShips === 0 || tokenBudget <= 0;

    const handleCalculate = useCallback(() => {
        const res = optimizeEngineering(
            tokenBudget,
            ships,
            engineeringStats,
            getGearPiece,
            (shipId) => getConfig(shipId)?.shipRole ?? null,
            onlyImprovingUpgrades
        );
        setResult(res);
    }, [tokenBudget, ships, engineeringStats, getGearPiece, getConfig, onlyImprovingUpgrades]);

    const grouped = useMemo(() => (result ? groupRecommendations(result) : []), [result]);

    const renderRightColumn = () => {
        if (!result) {
            return (
                <p className="text-theme-text-secondary text-sm">
                    Set your token budget and click Calculate to see recommendations.
                </p>
            );
        }

        if (grouped.length === 0) {
            return (
                <p className="text-theme-text-secondary text-sm">
                    No upgrades fit within this budget, or all tracked stats are already at max
                    level.
                </p>
            );
        }

        const roleImprovementEntries = Object.entries(result.roleImprovements) as [
            BaseRoleName,
            number,
        ][];

        return (
            <div className="space-y-3">
                <p className="text-xs text-theme-text-secondary">
                    Recommended spend &mdash; best total fleet % improvement / token first
                </p>
                {grouped.map((rec, index) => (
                    <RecommendationRow
                        key={`${rec.role}-${rec.statName}-${rec.fromLevel}`}
                        rec={rec}
                        rank={index + 1}
                    />
                ))}
                <div className="flex flex-wrap gap-3 pt-2">
                    <StatCard
                        title="Tokens Used"
                        value={`${result.tokensUsed.toLocaleString()} / ${tokenBudget.toLocaleString()}`}
                        color="yellow"
                    />
                    {roleImprovementEntries.map(([role, improvement]) => (
                        <StatCard
                            key={role}
                            title={`${ROLE_LABELS[role]} Fleet Improvement`}
                            value={`+${improvement.toFixed(2)}%`}
                            color="green"
                        />
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-row flex-wrap gap-6">
            {/* Left column */}
            <div className="flex flex-col gap-4 w-[220px] min-w-[180px] card">
                <div>
                    <Input
                        label="Token Budget"
                        type="number"
                        min={0}
                        value={tokenBudget}
                        onChange={(e) => {
                            setTokenBudget(Math.max(0, Number(e.target.value) || 0));
                            setResult(null);
                        }}
                    />
                </div>

                <div className="">
                    <div className="text-sm font-medium mb-2">Starred Fleet</div>
                    {totalStarredShips === 0 ? (
                        <p className="text-xs text-theme-text-secondary">
                            No starred ships. Star ships in your fleet to enable optimization.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {(Object.entries(starredCountByRole) as [BaseRoleName, number][]).map(
                                ([role, count]) => (
                                    <li key={role} className="flex justify-between text-sm">
                                        <span className="text-theme-text-secondary">
                                            {ROLE_LABELS[role]}
                                        </span>
                                        <span className="font-medium">{count}</span>
                                    </li>
                                )
                            )}
                        </ul>
                    )}
                </div>

                <Checkbox
                    label="Only show upgrades that improve score"
                    checked={onlyImprovingUpgrades}
                    onChange={(checked) => {
                        setOnlyImprovingUpgrades(checked);
                        setResult(null);
                    }}
                />

                <Button variant="primary" disabled={isDisabled} onClick={handleCalculate}>
                    Calculate
                </Button>
            </div>

            {/* Right column */}
            <div className="flex-1 min-w-0">{renderRightColumn()}</div>
        </div>
    );
};
