import React, { useState, useMemo, useCallback } from 'react';
import { Ship } from '../../types/ship';
import { StatName, EngineeringStat, Stat } from '../../types/stats';
import { ShipTypeName, STATS } from '../../constants';
import {
    ENGINEERING_STATS_BY_ROLE,
    getBaseRole,
    getUpgradeCost,
    getStatIncrement,
    isEngineeringFlatStat,
} from '../../constants/engineeringStats';
import { ShipSelector } from '../ship/ShipSelector';
import { RoleSelector } from '../ui/RoleSelector';
import { SimulationResults } from '../simulation/SimulationResults';
import { StatList } from '../stats/StatList';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useInventory } from '../../contexts/InventoryProvider';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { runSimulation, SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { calculatePriorityScore } from '../../utils/autogear/scoring';

export const EngineeringPreviewTab: React.FC = () => {
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
    const [selectedRole, setSelectedRole] = useState<ShipTypeName | ''>('');
    const [selectedStat, setSelectedStat] = useState<StatName | null>(null);

    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const { getGearPiece } = useInventory();
    const { getConfig } = useAutogearConfig();

    // Get base role from selected role (e.g., DEBUFFER_BOMBER -> DEBUFFER)
    const baseRole = useMemo(() => {
        if (!selectedRole) return null;
        return getBaseRole(selectedRole);
    }, [selectedRole]);

    // Get the 4 engineering stats for this base role
    const roleEngineeringStats = useMemo(() => {
        if (!baseRole) return [];
        return ENGINEERING_STATS_BY_ROLE[baseRole];
    }, [baseRole]);

    // Get current engineering stats for the base role
    const currentEngineeringStats = useMemo(() => {
        if (!baseRole) return undefined;
        return getEngineeringStatsForShipType(baseRole as ShipTypeName);
    }, [baseRole, getEngineeringStatsForShipType]);

    // Helper to get current level of a stat
    const getStatLevel = useCallback(
        (statName: StatName): number => {
            if (!currentEngineeringStats) return 0;
            const stat = currentEngineeringStats.stats.find((s) => s.name === statName);
            if (!stat) return 0;
            // For flat stats (hacking, security), divide by 2 to get level
            // For percentage stats, the value IS the level
            return isEngineeringFlatStat(statName) ? stat.value / 2 : stat.value;
        },
        [currentEngineeringStats]
    );

    // Create modified engineering stats with +1 level to selected stat
    const previewEngineeringStats = useMemo((): EngineeringStat | undefined => {
        if (!baseRole || !selectedStat) return currentEngineeringStats;

        const increment = getStatIncrement(selectedStat);
        const statType = isEngineeringFlatStat(selectedStat) ? 'flat' : 'percentage';

        // Start with current stats or empty
        const currentStats = currentEngineeringStats?.stats || [];

        // Find if the stat already exists
        const existingStatIndex = currentStats.findIndex((s) => s.name === selectedStat);

        let newStats: Stat[];
        if (existingStatIndex >= 0) {
            // Update existing stat
            newStats = currentStats.map((s, idx) =>
                idx === existingStatIndex ? { ...s, value: s.value + increment } : s
            );
        } else {
            // Add new stat
            newStats = [
                ...currentStats,
                { name: selectedStat, value: increment, type: statType } as Stat,
            ];
        }

        return {
            shipType: baseRole as ShipTypeName,
            stats: newStats,
        };
    }, [baseRole, selectedStat, currentEngineeringStats]);

    // Calculate current ship stats
    const currentStats = useMemo(() => {
        if (!selectedShip || !baseRole) return null;

        return calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment || {},
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            currentEngineeringStats,
            selectedShip.id
        );
    }, [selectedShip, baseRole, currentEngineeringStats, getGearPiece]);

    // Calculate preview ship stats (with +1 level to selected stat)
    const previewStats = useMemo(() => {
        if (!selectedShip || !baseRole || !selectedStat) return null;

        return calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment || {},
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            previewEngineeringStats,
            selectedShip.id
        );
    }, [selectedShip, baseRole, selectedStat, previewEngineeringStats, getGearPiece]);

    // Run simulation for current stats
    const currentSimulation = useMemo(() => {
        if (!currentStats || !selectedRole) return null;
        return runSimulation(currentStats.final, selectedRole);
    }, [currentStats, selectedRole]);

    // Run simulation for preview stats
    const previewSimulation = useMemo(() => {
        if (!previewStats || !selectedRole || !selectedStat) return null;
        return runSimulation(previewStats.final, selectedRole);
    }, [previewStats, selectedRole, selectedStat]);

    // Calculate set count from current equipment (used for role score calculations)
    const setCount = useMemo(() => {
        const counts: Record<string, number> = {};
        const equipment = selectedShip?.equipment || {};
        for (const gearId of Object.values(equipment)) {
            if (!gearId) continue;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) continue;
            counts[gear.setBonus] = (counts[gear.setBonus] || 0) + 1;
        }
        return counts;
    }, [selectedShip, getGearPiece]);

    // Calculate current role score (pure role-based scoring)
    const currentRoleScore = useMemo(() => {
        if (!currentStats || !selectedRole) return null;
        return calculatePriorityScore(currentStats.final, [], selectedRole, setCount);
    }, [currentStats, selectedRole, setCount]);

    // Calculate preview role score (pure role-based scoring)
    const previewRoleScore = useMemo(() => {
        if (!previewStats || !selectedRole || !selectedStat) return null;
        return calculatePriorityScore(previewStats.final, [], selectedRole, setCount);
    }, [previewStats, selectedRole, selectedStat, setCount]);

    // Format large numbers with commas
    const formatNumber = (num: number): string => {
        return Math.round(num).toLocaleString();
    };

    // Calculate efficiency: stat increment per 1000 engineering points
    const calculateEfficiency = (statName: StatName, cost: number): number => {
        if (cost === 0) return 0;
        const increment = getStatIncrement(statName);
        return (increment / cost) * 1000;
    };

    // Format efficiency value
    const formatEfficiency = (efficiency: number, statName: StatName): string => {
        const isFlat = isEngineeringFlatStat(statName);
        if (efficiency === 0) return '-';
        // Show with appropriate precision
        const formatted = efficiency >= 1 ? efficiency.toFixed(1) : efficiency.toFixed(2);
        return `${formatted}${isFlat ? '' : '%'}/1k`;
    };

    // Get primary simulation metrics by role for efficiency calculation
    const getSimulationEfficiencyMetrics = (
        current: SimulationSummary,
        preview: SimulationSummary,
        role: ShipTypeName,
        cost: number
    ): Array<{ label: string; change: number; efficiency: number; unit: string }> => {
        if (cost === 0) return [];
        const metrics: Array<{ label: string; change: number; efficiency: number; unit: string }> =
            [];

        const addMetric = (label: string, currentVal?: number, previewVal?: number, unit = '') => {
            if (currentVal !== undefined && previewVal !== undefined) {
                const change = previewVal - currentVal;
                if (change !== 0) {
                    metrics.push({
                        label,
                        change,
                        efficiency: (change / cost) * 1000,
                        unit,
                    });
                }
            }
        };

        // Role-specific primary metrics
        if (role.startsWith('ATTACKER')) {
            addMetric('Avg Damage', current.averageDamage, preview.averageDamage);
            addMetric('Highest Hit', current.highestHit, preview.highestHit);
        }

        if (role === 'DEFENDER') {
            addMetric('Effective HP', current.effectiveHP, preview.effectiveHP);
            addMetric('Survived Rounds', current.survivedRounds, preview.survivedRounds);
        }

        if (role === 'DEFENDER_SECURITY') {
            addMetric('Effective HP', current.effectiveHP, preview.effectiveHP);
            addMetric('Survived Rounds', current.survivedRounds, preview.survivedRounds);
            addMetric('Security', current.security, preview.security);
        }

        if (role === 'DEBUFFER') {
            addMetric('Hack Success', current.hackSuccessRate, preview.hackSuccessRate, '%');
            addMetric('Avg Damage', current.averageDamage, preview.averageDamage);
        }

        if (role === 'DEBUFFER_DEFENSIVE') {
            addMetric('Hack Success', current.hackSuccessRate, preview.hackSuccessRate, '%');
            addMetric('Hacking', current.hacking, preview.hacking);
            addMetric('Effective HP', current.effectiveHP, preview.effectiveHP);
            addMetric('Survived Rounds', current.survivedRounds, preview.survivedRounds);
        }

        if (role === 'DEBUFFER_DEFENSIVE_SECURITY') {
            addMetric('Hack Success', current.hackSuccessRate, preview.hackSuccessRate, '%');
            addMetric('Hacking', current.hacking, preview.hacking);
            addMetric('Security', current.security, preview.security);
            addMetric('Effective HP', current.effectiveHP, preview.effectiveHP);
            addMetric('Survived Rounds', current.survivedRounds, preview.survivedRounds);
        }

        if (role === 'DEBUFFER_BOMBER') {
            addMetric('Avg Damage', current.averageDamage, preview.averageDamage);
            addMetric('Highest Hit', current.highestHit, preview.highestHit);
            addMetric('Hacking', current.hacking, preview.hacking);
        }

        if (role === 'DEBUFFER_CORROSION') {
            addMetric('Hacking', current.hacking, preview.hacking);
        }

        if (role === 'SUPPORTER') {
            addMetric('Avg Healing', current.averageHealing, preview.averageHealing);
        }

        if (role === 'SUPPORTER_BUFFER') {
            addMetric('Effective HP', current.effectiveHP, preview.effectiveHP);
            addMetric('Survived Rounds', current.survivedRounds, preview.survivedRounds);
            addMetric('Speed', current.speed, preview.speed);
        }

        if (role === 'SUPPORTER_OFFENSIVE') {
            addMetric('Attack', current.attack, preview.attack);
            addMetric('Speed', current.speed, preview.speed);
        }

        if (role === 'SUPPORTER_SHIELD') {
            addMetric('HP', current.hp, preview.hp);
        }

        return metrics;
    };

    // Calculate simulation efficiency metrics
    const simulationEfficiency = useMemo(() => {
        if (!selectedStat || !currentSimulation || !previewSimulation || !selectedRole) return null;
        const cost = getUpgradeCost(getStatLevel(selectedStat));
        return getSimulationEfficiencyMetrics(
            currentSimulation,
            previewSimulation,
            selectedRole,
            cost
        );
    }, [selectedStat, currentSimulation, previewSimulation, selectedRole, getStatLevel]);

    // Calculate role score efficiency
    const roleScoreEfficiency = useMemo(() => {
        if (!selectedStat || currentRoleScore === null || previewRoleScore === null) return null;
        const cost = getUpgradeCost(getStatLevel(selectedStat));
        if (cost === 0) return null;
        const change = previewRoleScore - currentRoleScore;
        // Handle edge case where current score is 0 (can't calculate percentage)
        const percentChange = currentRoleScore !== 0 ? (change / currentRoleScore) * 100 : null;
        return {
            currentScore: currentRoleScore,
            previewScore: previewRoleScore,
            change,
            percentChange,
            efficiencyPercent: percentChange !== null ? (percentChange / cost) * 1000 : null,
            // Also include absolute efficiency for when percentage isn't available
            efficiencyAbsolute: (change / cost) * 1000,
        };
    }, [selectedStat, currentRoleScore, previewRoleScore, getStatLevel]);

    return (
        <div className="space-y-6">
            {/* Ship and Role Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium mb-2">Ship</label>
                    <ShipSelector
                        selected={selectedShip}
                        onSelect={(ship) => {
                            setSelectedShip(ship);
                            setSelectedStat(null);
                            // Auto-select the ship's saved role from autogear config
                            const savedConfig = getConfig(ship.id);
                            if (savedConfig?.shipRole) {
                                setSelectedRole(savedConfig.shipRole);
                            }
                        }}
                        variant="compact"
                    />
                    <RoleSelector
                        value={selectedRole}
                        onChange={(role) => {
                            setSelectedRole(role);
                            setSelectedStat(null);
                        }}
                        label="Role"
                    />
                </div>
            </div>

            {/* Empty States */}
            {!selectedShip && (
                <div className="text-center text-gray-400 py-8">
                    Select a ship to preview engineering upgrades
                </div>
            )}

            {selectedShip && !selectedRole && (
                <div className="text-center text-gray-400 py-8">
                    Select a role to see available upgrades
                </div>
            )}

            {selectedShip && selectedRole && !currentEngineeringStats && (
                <div className="text-center text-gray-400 py-8">
                    No engineering stats configured for {baseRole}. Add them in the Engineering
                    Stats tab.
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Engineering Stat Radio Buttons */}
                {selectedShip && selectedRole && baseRole && (
                    <div className="card space-y-2 mt-4">
                        <h3 className="text-sm font-medium mb-3">Select stat to preview upgrade</h3>
                        <div className="space-y-2">
                            {roleEngineeringStats.map((statName) => {
                                const currentLevel = getStatLevel(statName);
                                const cost = getUpgradeCost(currentLevel);
                                const isMaxLevel = currentLevel >= 20;

                                return (
                                    <label
                                        key={statName}
                                        className={`flex items-center justify-between p-3 border border-dark-border cursor-pointer transition-colors ${
                                            selectedStat === statName
                                                ? 'bg-primary/20 border-primary'
                                                : 'hover:bg-dark-border'
                                        } ${isMaxLevel ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="radio"
                                                name="engineering-stat"
                                                value={statName}
                                                checked={selectedStat === statName}
                                                onChange={() =>
                                                    !isMaxLevel && setSelectedStat(statName)
                                                }
                                                disabled={isMaxLevel}
                                                className="text-primary focus:ring-primary"
                                            />
                                            <span>
                                                {STATS[statName].label}
                                                <span className="text-gray-400 ml-2">
                                                    (Level {currentLevel} → {currentLevel + 1})
                                                </span>
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            {!isMaxLevel && (
                                                <span className="text-green-400">
                                                    {formatEfficiency(
                                                        calculateEfficiency(statName, cost),
                                                        statName
                                                    )}
                                                </span>
                                            )}
                                            <span className="text-gray-400">
                                                {isMaxLevel ? 'MAX' : `${formatNumber(cost)} EP`}
                                            </span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Preview Panel - Simulation Results and Stat List */}
                {selectedShip &&
                    selectedRole &&
                    selectedStat &&
                    currentStats &&
                    previewStats &&
                    currentSimulation &&
                    previewSimulation && (
                        <div className="col-span-1 space-y-4">
                            <SimulationResults
                                currentSimulation={currentSimulation}
                                suggestedSimulation={previewSimulation}
                                role={selectedRole}
                                alwaysColumn
                                showCurrent={false}
                            />
                            {/* Role Score Efficiency */}
                            {roleScoreEfficiency && (
                                <div className="card">
                                    <h3 className="text-lg font-semibold mb-3">
                                        Role Score Efficiency
                                    </h3>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">Role Score</span>
                                            <div className="flex items-center gap-3">
                                                <span className="text-gray-300">
                                                    {formatNumber(roleScoreEfficiency.currentScore)}
                                                </span>
                                                <span className="text-gray-500">→</span>
                                                <span className="text-gray-300">
                                                    {formatNumber(roleScoreEfficiency.previewScore)}
                                                </span>
                                                <span
                                                    className={
                                                        roleScoreEfficiency.change > 0
                                                            ? 'text-green-400'
                                                            : roleScoreEfficiency.change < 0
                                                              ? 'text-red-400'
                                                              : 'text-gray-400'
                                                    }
                                                >
                                                    ({roleScoreEfficiency.change > 0 ? '+' : ''}
                                                    {roleScoreEfficiency.percentChange !== null
                                                        ? `${roleScoreEfficiency.percentChange.toFixed(2)}%`
                                                        : formatNumber(roleScoreEfficiency.change)}
                                                    )
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">Score Efficiency</span>
                                            <span className="text-primary font-medium">
                                                {roleScoreEfficiency.efficiencyPercent !== null ? (
                                                    <>
                                                        {roleScoreEfficiency.efficiencyPercent > 0
                                                            ? '+'
                                                            : ''}
                                                        {roleScoreEfficiency.efficiencyPercent.toFixed(
                                                            3
                                                        )}
                                                        %/1k EP
                                                    </>
                                                ) : (
                                                    <>
                                                        {roleScoreEfficiency.efficiencyAbsolute > 0
                                                            ? '+'
                                                            : ''}
                                                        {roleScoreEfficiency.efficiencyAbsolute.toFixed(
                                                            1
                                                        )}
                                                        /1k EP
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {/* Simulation Efficiency */}
                            {simulationEfficiency && simulationEfficiency.length > 0 && (
                                <div className="card">
                                    <h3 className="text-lg font-semibold mb-3">
                                        Upgrade Efficiency (per 1,000 EP)
                                    </h3>
                                    <div className="space-y-2">
                                        {simulationEfficiency.map((metric) => (
                                            <div
                                                key={metric.label}
                                                className="flex items-center justify-between"
                                            >
                                                <span className="text-gray-400">
                                                    {metric.label}
                                                </span>
                                                <div className="flex items-center gap-3">
                                                    <span
                                                        className={
                                                            metric.change > 0
                                                                ? 'text-green-400'
                                                                : 'text-red-400'
                                                        }
                                                    >
                                                        {metric.change > 0 ? '+' : ''}
                                                        {metric.change >= 1000
                                                            ? formatNumber(metric.change)
                                                            : metric.change.toFixed(1)}
                                                        {metric.unit}
                                                    </span>
                                                    <span className="text-gray-500">→</span>
                                                    <span className="text-primary font-medium">
                                                        {metric.efficiency >= 1
                                                            ? metric.efficiency.toFixed(1)
                                                            : metric.efficiency.toFixed(3)}
                                                        {metric.unit}/1k EP
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="card">
                                <StatList
                                    stats={previewStats.final}
                                    comparisonStats={currentStats.final}
                                    title="Stats After Upgrade"
                                />
                            </div>
                        </div>
                    )}
            </div>
        </div>
    );
};
