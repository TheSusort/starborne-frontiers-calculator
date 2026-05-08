import React, { useState, useMemo, useCallback } from 'react';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { Button, Input, StatCard } from '../ui';
import {
    optimizeEngineering,
    type OptimizationResult,
    type UpgradeRecommendation,
} from '../../utils/engineering/engineeringOptimizer';
import { getBaseRole, type BaseRoleName } from '../../constants/engineeringStats';
import { STATS } from '../../constants/stats';

const ROLE_LABELS: Record<BaseRoleName, string> = {
    ATTACKER: 'Attacker',
    DEFENDER: 'Defender',
    DEBUFFER: 'Debuffer',
    SUPPORTER: 'Supporter',
};

interface RecommendationRowProps {
    rec: UpgradeRecommendation;
    rank: number;
}

const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec, rank }) => {
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
                            Level {rec.currentLevel} &rarr; {rec.nextLevel} &middot;{' '}
                            {rec.tokenCost.toLocaleString()} tokens
                        </div>
                        <div className="text-xs text-theme-text-secondary mt-0.5">
                            &ldquo;{ROLE_LABELS[rec.role].toLowerCase()} score&rdquo;
                        </div>
                    </div>
                </div>
                <span className="text-green-400 font-semibold text-sm shrink-0">
                    +{rec.percentImprovement.toFixed(2)}%
                </span>
            </div>
        </div>
    );
};

export const EngineeringOptimizer: React.FC = () => {
    const { ships } = useShips();
    const { getGearPiece } = useInventory();
    const { engineeringStats } = useEngineeringStats();

    const [tokenBudget, setTokenBudget] = useState<number>(10000);
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
        const res = optimizeEngineering(tokenBudget, ships, engineeringStats, getGearPiece);
        setResult(res);
    }, [tokenBudget, ships, engineeringStats, getGearPiece]);

    const renderRightColumn = () => {
        if (!result) {
            return (
                <p className="text-theme-text-secondary text-sm">
                    Set your token budget and click Calculate to see recommendations.
                </p>
            );
        }

        if (result.recommendations.length === 0) {
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
                    Recommended spend &mdash; best % improvement / token first
                </p>
                {result.recommendations.map((rec, index) => (
                    <RecommendationRow
                        key={`${rec.role}-${rec.statName}-${rec.currentLevel}`}
                        rec={rec}
                        rank={index + 1}
                    />
                ))}
                <div className="flex flex-wrap gap-3 pt-2">
                    <StatCard
                        title="Tokens Used"
                        value={result.tokensUsed.toLocaleString()}
                        color="yellow"
                    />
                    {roleImprovementEntries.map(([role, improvement]) => (
                        <StatCard
                            key={role}
                            title={`${ROLE_LABELS[role]} Improvement`}
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
            <div className="flex flex-col gap-4 w-[220px] min-w-[180px]">
                <Input
                    label="Token Budget"
                    type="number"
                    min={0}
                    value={tokenBudget}
                    onChange={(e) => setTokenBudget(Math.max(0, Number(e.target.value) || 0))}
                />

                <div className="card">
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

                <Button variant="primary" disabled={isDisabled} onClick={handleCalculate}>
                    Calculate Optimal Spend
                </Button>

                {totalStarredShips === 0 && (
                    <p className="text-xs text-theme-text-secondary">
                        Star ships in your fleet to enable this feature.
                    </p>
                )}
            </div>

            {/* Right column */}
            <div className="flex-1 min-w-0">{renderRightColumn()}</div>
        </div>
    );
};
