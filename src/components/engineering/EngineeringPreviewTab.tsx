import React, { useState, useMemo } from 'react';
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
import { StatList } from '../stats/StatList';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useInventory } from '../../contexts/InventoryProvider';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
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
    const getStatLevel = (statName: StatName): number => {
        if (!currentEngineeringStats) return 0;
        const stat = currentEngineeringStats.stats.find((s) => s.name === statName);
        if (!stat) return 0;
        // For flat stats (hacking, security), divide by 2 to get level
        // For percentage stats, the value IS the level
        return isEngineeringFlatStat(statName) ? stat.value / 2 : stat.value;
    };

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

    // Calculate current role score
    const currentScore = useMemo(() => {
        if (!currentStats || !selectedRole) return 0;
        return calculatePriorityScore(currentStats.final, [], selectedRole);
    }, [currentStats, selectedRole]);

    // Calculate preview role score
    const previewScore = useMemo(() => {
        if (!previewStats || !selectedRole || !selectedStat) return 0;
        return calculatePriorityScore(previewStats.final, [], selectedRole);
    }, [previewStats, selectedRole, selectedStat]);

    const scoreDiff = selectedStat ? previewScore - currentScore : 0;

    // Format large numbers with commas
    const formatNumber = (num: number): string => {
        return Math.round(num).toLocaleString();
    };

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
                    <div className="bg-dark-lighter border border-dark-border p-4 space-y-2">
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
                                        <span className="text-gray-400">
                                            {isMaxLevel ? 'MAX' : `Cost: ${formatNumber(cost)}`}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Preview Panel */}
                {selectedShip && selectedRole && selectedStat && previewStats && currentStats && (
                    <div className="bg-dark-lighter border border-dark-border p-4 space-y-4">
                        <h3 className="text-sm font-medium">Preview</h3>

                        {/* Role Score */}
                        <div className="flex items-center gap-2 text-lg">
                            <span className="text-gray-400">Role Score:</span>
                            <span>{formatNumber(currentScore)}</span>
                            <span className="text-gray-400">→</span>
                            <span>{formatNumber(previewScore)}</span>
                            <span className={scoreDiff > 0 ? 'text-green-500' : 'text-red-500'}>
                                ({scoreDiff > 0 ? '+' : ''}
                                {formatNumber(scoreDiff)})
                            </span>
                        </div>

                        {/* Stat List */}
                        <StatList stats={previewStats.final} comparisonStats={currentStats.final} />
                    </div>
                )}
            </div>
        </div>
    );
};
