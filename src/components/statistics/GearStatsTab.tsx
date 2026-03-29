import React, { useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { GearSetName } from '../../constants';
import { RarityName } from '../../constants/rarities';
import { Select, StatCard } from '../ui';
import { calculateGearStatistics, filterGear } from '../../utils/statistics/gearStats';
import { BaseChart, ChartTooltip } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { GearSnapshot } from '../../types/statisticsSnapshot';
import { mergeDistributions } from '../../utils/statistics/mergeDistributions';

interface GearStatsTabProps {
    gear: GearPiece[];
    ships: Ship[];
    previousStats?: GearSnapshot;
}

const CHART_COLORS = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#06b6d4',
    '#f97316',
    '#ec4899',
    '#14b8a6',
    '#84cc16',
];

const RARITY_COLORS: Record<string, string> = {
    common: '#9ca3af',
    uncommon: '#22c55e',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f97316',
};

export const GearStatsTab: React.FC<GearStatsTabProps> = ({ gear, ships, previousStats }) => {
    const colors = useThemeColors();
    // Filter out implants - only show actual gear pieces
    const gearOnly = useMemo(() => {
        return gear.filter((piece) => !piece.slot.startsWith('implant_'));
    }, [gear]);

    const [setFilter, setSetFilter] = useState<GearSetName | 'all' | 'none'>('all');
    const [mainStatFilter, setMainStatFilter] = useState<string>('all');
    const [rarityFilter, setRarityFilter] = useState<RarityName | 'all'>('all');

    const filteredGear = useMemo(() => {
        return filterGear(gearOnly, {
            setBonus: setFilter,
            mainStatType: mainStatFilter,
            rarity: rarityFilter,
        });
    }, [gearOnly, setFilter, mainStatFilter, rarityFilter]);

    const stats = useMemo(() => {
        return calculateGearStatistics(filteredGear, ships);
    }, [filteredGear, ships]);

    // Prepare chart data
    const setCurrentData = stats.bySet
        .slice(0, 10)
        .map((s) => ({ name: s.setName, value: s.count }));
    const setChartData = previousStats
        ? mergeDistributions(
              setCurrentData,
              previousStats.bySet.slice(0, 10).map((s) => ({ name: s.setName, value: s.count }))
          )
        : setCurrentData;

    const mainStatCurrentData = stats.byMainStat.slice(0, 10).map((s) => ({
        name: `${s.statName} (${s.statType})`,
        value: s.count,
    }));
    const mainStatChartData = previousStats
        ? mergeDistributions(
              mainStatCurrentData,
              previousStats.byMainStat.slice(0, 10).map((s) => ({
                  name: `${s.statName} (${s.statType})`,
                  value: s.count,
              }))
          )
        : mainStatCurrentData;

    const rarityCurrentData = stats.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
    }));

    const starCurrentData = stats.byStarLevel.map((s) => ({
        name: String(s.stars) + ' ★',
        value: s.count,
    }));
    const starChartData = previousStats
        ? mergeDistributions(
              starCurrentData,
              previousStats.byStarLevel.map((s) => ({
                  name: String(s.stars) + ' ★',
                  value: s.count,
              }))
          )
        : starCurrentData;

    const levelCurrentData = stats.byLevel.map((l) => ({ name: l.range, value: l.count }));
    const levelChartData = previousStats
        ? mergeDistributions(
              levelCurrentData,
              previousStats.byLevel.map((l) => ({ name: l.range, value: l.count }))
          )
        : levelCurrentData;

    const slotCurrentData = stats.bySlot.map((s) => ({ name: s.slot, value: s.count }));
    const slotChartData = previousStats
        ? mergeDistributions(
              slotCurrentData,
              previousStats.bySlot.map((s) => ({ name: s.slot, value: s.count }))
          )
        : slotCurrentData;

    // Get unique main stat types for filter
    const mainStatOptions = useMemo(() => {
        const options = new Set<string>();
        gearOnly.forEach((piece) => {
            if (piece.mainStat) {
                options.add(`${piece.mainStat.name}_${piece.mainStat.type}`);
            }
        });
        return Array.from(options).sort();
    }, [gearOnly]);

    // Get unique set bonuses for filter
    const setOptions = useMemo(() => {
        const options = new Set<string>();
        gearOnly.forEach((piece) => {
            if (piece.setBonus) {
                options.add(piece.setBonus);
            }
        });
        return Array.from(options).sort();
    }, [gearOnly]);

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Gear Set
                        </label>
                        <Select
                            value={setFilter}
                            onChange={(value) => setSetFilter(value)}
                            options={[
                                { value: 'all', label: 'All Sets' },
                                { value: 'none', label: 'No Set' },
                                ...setOptions.map((set) => ({
                                    value: set,
                                    label: set,
                                })),
                            ]}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Main Stat
                        </label>
                        <Select
                            value={mainStatFilter}
                            onChange={(value) => setMainStatFilter(value)}
                            options={[
                                { value: 'all', label: 'All Stats' },
                                ...mainStatOptions.map((stat) => {
                                    const [name, type] = stat.split('_');
                                    return {
                                        value: stat,
                                        label: `${name} (${type})`,
                                    };
                                }),
                            ]}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Rarity
                        </label>
                        <Select
                            value={rarityFilter}
                            onChange={(value) => setRarityFilter(value)}
                            options={[
                                { value: 'all', label: 'All Rarities' },
                                { value: 'common', label: 'Common' },
                                { value: 'uncommon', label: 'Uncommon' },
                                { value: 'rare', label: 'Rare' },
                                { value: 'epic', label: 'Epic' },
                                { value: 'legendary', label: 'Legendary' },
                            ]}
                        />
                    </div>
                </div>
            </div>

            {/* Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Total Gear"
                    value={stats.total}
                    color="blue"
                    previousValue={previousStats?.total}
                />
                <StatCard
                    title="Equipped"
                    value={stats.equippedCount}
                    subtitle={`${stats.equippedPercentage.toFixed(1)}%`}
                    color="green"
                    previousValue={previousStats?.equippedPercentage}
                />
                <StatCard
                    title="Unequipped"
                    value={stats.unequippedCount}
                    subtitle={`${stats.unequippedPercentage.toFixed(1)}%`}
                    color="yellow"
                />
                <StatCard
                    title="Avg Level"
                    value={stats.averageLevel.toFixed(1)}
                    subtitle={`Avg Stars: ${stats.averageStarLevel.toFixed(1)}`}
                    color="purple"
                    previousValue={previousStats?.averageLevel}
                />
            </div>

            {/* Additional Insights */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard
                    title="Max Level"
                    value={stats.maxLevelCount}
                    subtitle={`${stats.maxLevelPercentage.toFixed(1)}%`}
                    color="blue"
                    previousValue={previousStats?.maxLevelCount}
                />
                <StatCard
                    title="Most Common Set"
                    value={stats.bySet[0]?.setName || 'N/A'}
                    subtitle={`${stats.bySet[0]?.count || 0} pieces`}
                    color="green"
                />
                <StatCard
                    title="Most Common Main Stat"
                    value={stats.byMainStat[0]?.statName || 'N/A'}
                    subtitle={`${stats.byMainStat[0]?.count || 0} pieces`}
                    color="purple"
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Set Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Top 10 Gear Sets</h3>
                    <BaseChart height={300}>
                        <BarChart data={setChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis type="number" stroke={colors.axisStroke} />
                            <YAxis
                                dataKey="name"
                                type="category"
                                stroke={colors.axisStroke}
                                width={100}
                                interval={0}
                                style={{ fontSize: '11px' }}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" fill="#3b82f6" name="Current" />
                                    <Bar dataKey="previous" fill="#3b82f666" name="Previous" />
                                </>
                            ) : (
                                <Bar dataKey="value" fill="#3b82f6" />
                            )}
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Main Stat Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Top 10 Main Stats</h3>
                    <BaseChart height={300}>
                        <BarChart data={mainStatChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis type="number" stroke={colors.axisStroke} />
                            <YAxis
                                dataKey="name"
                                type="category"
                                stroke={colors.axisStroke}
                                width={120}
                                interval={0}
                                style={{ fontSize: '11px' }}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" fill="#10b981" name="Current" />
                                    <Bar dataKey="previous" fill="#10b98166" name="Previous" />
                                </>
                            ) : (
                                <Bar dataKey="value" fill="#10b981" />
                            )}
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Rarity Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Rarity Distribution</h3>
                    <BaseChart height={300}>
                        {previousStats ? (
                            <BarChart
                                data={mergeDistributions(
                                    rarityCurrentData,
                                    previousStats.byRarity.map((r) => ({
                                        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
                                        value: r.count,
                                    }))
                                )}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="current" fill="#3b82f6" name="Current" />
                                <Bar dataKey="previous" fill="#3b82f666" name="Previous" />
                            </BarChart>
                        ) : (
                            <PieChart>
                                <Pie
                                    data={rarityCurrentData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={(entry) => `${entry.name}: ${entry.value}`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {rarityCurrentData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={
                                                RARITY_COLORS[entry.name.toLowerCase()] ||
                                                CHART_COLORS[index % CHART_COLORS.length]
                                            }
                                        />
                                    ))}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                        )}
                    </BaseChart>
                </div>

                {/* Star Level Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Star Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={starChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis dataKey="name" stroke={colors.axisStroke} />
                            <YAxis stroke={colors.axisStroke} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" fill="#f59e0b" name="Current" />
                                    <Bar dataKey="previous" fill="#f59e0b66" name="Previous" />
                                </>
                            ) : (
                                <Bar dataKey="value" fill="#f59e0b" />
                            )}
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Level Distribution */}
                <div className="card lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4">Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={levelChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis dataKey="name" stroke={colors.axisStroke} />
                            <YAxis stroke={colors.axisStroke} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" fill="#8b5cf6" name="Current" />
                                    <Bar dataKey="previous" fill="#8b5cf666" name="Previous" />
                                </>
                            ) : (
                                <Bar dataKey="value" fill="#8b5cf6" />
                            )}
                        </BarChart>
                    </BaseChart>
                </div>
            </div>

            {/* Slot Distribution */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Gear by Slot</h3>
                <BaseChart height={300}>
                    <BarChart data={slotChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                        <XAxis dataKey="name" stroke={colors.axisStroke} />
                        <YAxis stroke={colors.axisStroke} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                        {previousStats ? (
                            <>
                                <Bar dataKey="current" fill="#06b6d4" name="Current" />
                                <Bar dataKey="previous" fill="#06b6d466" name="Previous" />
                            </>
                        ) : (
                            <Bar dataKey="value" fill="#06b6d4" />
                        )}
                    </BarChart>
                </BaseChart>
            </div>
        </div>
    );
};
