import React, { useMemo, useState } from 'react';
import {
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { RarityName } from '../../constants/rarities';
import { Select, StatCard } from '../ui';
import { calculateImplantStatistics, filterImplants } from '../../utils/statistics/implantsStats';
import { BaseChart, ChartTooltip } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ImplantsSnapshot } from '../../types/statisticsSnapshot';
import { mergeDistributions } from '../../utils/statistics/mergeDistributions';

interface ImplantsStatsTabProps {
    gear: GearPiece[];
    ships: Ship[];
    previousStats?: ImplantsSnapshot;
}

const CHART_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ef4444', // red
];

const RARITY_COLORS: Record<string, string> = {
    common: '#9ca3af', // gray
    uncommon: '#22c55e', // green
    rare: '#3b82f6', // blue
    epic: '#a855f7', // purple
    legendary: '#f97316', // orange
};

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const IMPLANT_TYPE_LABELS: Record<string, string> = {
    implant_minor_alpha: 'Minor Alpha',
    implant_minor_gamma: 'Minor Gamma',
    implant_minor_sigma: 'Minor Sigma',
    implant_major: 'Major',
    implant_ultimate: 'Ultimate',
};

function buildImplantRarityStackedData(
    implants: GearPiece[],
    groupBy: (piece: GearPiece) => string,
    fixedOrder?: string[]
): { data: Record<string, string | number>[]; rarities: string[] } {
    const groupMap = new Map<string, Map<string, number>>();
    const totalByGroup = new Map<string, number>();

    implants.forEach((piece) => {
        const group = groupBy(piece);
        if (!groupMap.has(group)) {
            groupMap.set(group, new Map());
        }
        const rarityMap = groupMap.get(group)!;
        const rarity = piece.rarity || 'common';
        rarityMap.set(rarity, (rarityMap.get(rarity) || 0) + 1);
        totalByGroup.set(group, (totalByGroup.get(group) || 0) + 1);
    });

    let sortedGroups: string[];
    if (fixedOrder) {
        sortedGroups = fixedOrder.filter((name) => groupMap.has(name));
    } else {
        sortedGroups = Array.from(totalByGroup.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);
    }

    const presentRarities = new Set<string>();
    sortedGroups.forEach((group) => {
        const rarityMap = groupMap.get(group)!;
        rarityMap.forEach((_, rarity) => presentRarities.add(rarity));
    });
    const rarities = RARITY_ORDER.filter((r) => presentRarities.has(r));

    const data = sortedGroups.map((group) => {
        const row: Record<string, string | number> = { name: group };
        const rarityMap = groupMap.get(group)!;
        rarities.forEach((rarity) => {
            row[rarity] = rarityMap.get(rarity) || 0;
        });
        return row;
    });

    return { data, rarities };
}

export const ImplantsStatsTab: React.FC<ImplantsStatsTabProps> = ({
    gear,
    ships,
    previousStats,
}) => {
    const colors = useThemeColors();
    // Filter to only implants
    const implantsOnly = useMemo(() => {
        return gear.filter((piece) => piece.slot.startsWith('implant_'));
    }, [gear]);

    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [rarityFilter, setRarityFilter] = useState<RarityName | 'all'>('all');

    const filteredImplants = useMemo(() => {
        return filterImplants(implantsOnly, {
            type: typeFilter,
            rarity: rarityFilter,
        });
    }, [implantsOnly, typeFilter, rarityFilter]);

    const stats = useMemo(() => {
        return calculateImplantStatistics(filteredImplants, ships);
    }, [filteredImplants, ships]);

    // Prepare chart data
    const rarityChartData = stats.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
        percentage: r.percentage.toFixed(1),
    }));

    const rarityMergedData = previousStats
        ? mergeDistributions(
              rarityChartData.map((r) => ({ name: r.name, value: r.value })),
              previousStats.byRarity.map((r) => ({
                  name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
                  value: r.count,
              }))
          )
        : null;

    const typeCurrentData = stats.byType.map((t) => ({ name: t.type, value: t.count }));
    const typeMergedData = previousStats
        ? mergeDistributions(
              typeCurrentData,
              previousStats.byType.map((t) => ({ name: t.type, value: t.count }))
          )
        : null;

    // Rarity-stacked data for type distribution
    const typeByRarity = useMemo(
        () =>
            buildImplantRarityStackedData(
                filteredImplants,
                (p) => IMPLANT_TYPE_LABELS[p.slot] || p.slot
            ),
        [filteredImplants]
    );

    // Rarity-stacked data for set bonus distribution per implant type
    const setsByTypeByRarity = useMemo(() => {
        const typeGroups = new Map<string, GearPiece[]>();
        filteredImplants.forEach((implant) => {
            const type = IMPLANT_TYPE_LABELS[implant.slot] || implant.slot;
            if (!typeGroups.has(type)) {
                typeGroups.set(type, []);
            }
            typeGroups.get(type)!.push(implant);
        });

        const order = ['Minor Alpha', 'Minor Gamma', 'Minor Sigma', 'Major', 'Ultimate'];
        return order
            .filter((type) => typeGroups.has(type))
            .map((type) => ({
                type,
                ...buildImplantRarityStackedData(
                    typeGroups.get(type)!,
                    (p) => p.setBonus || 'None'
                ),
            }));
    }, [filteredImplants]);

    // Get unique implant types for filter
    const typeOptions = useMemo(() => {
        const types = new Set<string>();
        stats.byType.forEach((t) => {
            types.add(t.type);
        });
        return Array.from(types).sort();
    }, [stats.byType]);

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Implant Type
                        </label>
                        <Select
                            value={typeFilter}
                            onChange={(value) => setTypeFilter(value)}
                            options={[
                                { value: 'all', label: 'All Types' },
                                ...typeOptions.map((type) => ({
                                    value: type,
                                    label: type,
                                })),
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                    title="Total Implants"
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
                    color="orange"
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Rarity Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Rarity Distribution</h3>
                    <BaseChart height={300}>
                        {rarityMergedData ? (
                            <BarChart data={rarityMergedData}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="current" name="Current" fill="#3b82f6" />
                                <Bar dataKey="previous" name="Previous" fill="#6b7280" />
                            </BarChart>
                        ) : (
                            <PieChart>
                                <Pie
                                    data={rarityChartData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={(entry) => `${entry.name}: ${entry.value}`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {rarityChartData.map((entry, index) => (
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

                {/* Type Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Type Distribution</h3>
                    <BaseChart height={300}>
                        {typeMergedData ? (
                            <BarChart data={typeMergedData}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="current" name="Current" fill="#8b5cf6" />
                                <Bar dataKey="previous" name="Previous" fill="#6b7280" />
                            </BarChart>
                        ) : (
                            <BarChart data={typeByRarity.data}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                {typeByRarity.rarities.map((rarity) => (
                                    <Bar
                                        key={rarity}
                                        dataKey={rarity}
                                        stackId="a"
                                        fill={RARITY_COLORS[rarity]}
                                        name={rarity.charAt(0).toUpperCase() + rarity.slice(1)}
                                    />
                                ))}
                                <Legend />
                            </BarChart>
                        )}
                    </BaseChart>
                </div>
            </div>

            {/* Set Bonus Distribution by Type */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Set Bonus Distribution by Type</h3>

                {/* Minor Implants Row */}
                <div className="mb-6">
                    <h4 className="text-sm font-semibold mb-3 text-theme-text-secondary">
                        Minor Implants
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {stats.setsByType
                            .filter((typeData) => typeData.type.startsWith('Minor'))
                            .map((typeData) => {
                                const prevTypeData = previousStats?.setsByType?.find(
                                    (p) => p.type === typeData.type
                                );
                                const chartData = prevTypeData
                                    ? mergeDistributions(
                                          typeData.setBonuses.map((s) => ({
                                              name: s.setName,
                                              value: s.count,
                                          })),
                                          prevTypeData.setBonuses.map((s) => ({
                                              name: s.setName,
                                              value: s.count,
                                          }))
                                      )
                                    : null;
                                const rarityData = setsByTypeByRarity.find(
                                    (s) => s.type === typeData.type
                                );
                                return (
                                    <div key={typeData.type} className="flex flex-col">
                                        <h5 className="text-md font-semibold mb-2 text-center">
                                            {typeData.type}
                                        </h5>
                                        <BaseChart height={300}>
                                            <BarChart
                                                data={
                                                    chartData ||
                                                    rarityData?.data ||
                                                    typeData.setBonuses
                                                }
                                                layout="vertical"
                                                margin={{ left: 20 }}
                                            >
                                                <CartesianGrid
                                                    strokeDasharray="3 3"
                                                    stroke={colors.gridStroke}
                                                />
                                                <XAxis type="number" stroke={colors.axisStroke} />
                                                <YAxis
                                                    dataKey={
                                                        chartData
                                                            ? 'name'
                                                            : rarityData
                                                              ? 'name'
                                                              : 'setName'
                                                    }
                                                    type="category"
                                                    stroke={colors.axisStroke}
                                                    width={120}
                                                    interval={0}
                                                    style={{ fontSize: '10px' }}
                                                />
                                                <Tooltip
                                                    content={<ChartTooltip />}
                                                    cursor={{ fill: 'transparent' }}
                                                />
                                                {chartData ? (
                                                    <>
                                                        <Bar
                                                            dataKey="current"
                                                            name="Current"
                                                            fill="#10b981"
                                                        />
                                                        <Bar
                                                            dataKey="previous"
                                                            name="Previous"
                                                            fill="#6b7280"
                                                        />
                                                    </>
                                                ) : rarityData ? (
                                                    rarityData.rarities.map((rarity) => (
                                                        <Bar
                                                            key={rarity}
                                                            dataKey={rarity}
                                                            stackId="a"
                                                            fill={RARITY_COLORS[rarity]}
                                                            name={
                                                                rarity.charAt(0).toUpperCase() +
                                                                rarity.slice(1)
                                                            }
                                                        />
                                                    ))
                                                ) : (
                                                    <Bar dataKey="count" fill="#10b981" />
                                                )}
                                                {!chartData && rarityData && <Legend />}
                                            </BarChart>
                                        </BaseChart>
                                    </div>
                                );
                            })}
                    </div>
                </div>

                {/* Major and Ultimate Row */}
                <div>
                    <h4 className="text-sm font-semibold mb-3 text-theme-text-secondary">
                        Major & Ultimate Implants
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {stats.setsByType
                            .filter(
                                (typeData) =>
                                    typeData.type === 'Major' || typeData.type === 'Ultimate'
                            )
                            .map((typeData) => {
                                const prevTypeData = previousStats?.setsByType?.find(
                                    (p) => p.type === typeData.type
                                );
                                const chartData = prevTypeData
                                    ? mergeDistributions(
                                          typeData.setBonuses.map((s) => ({
                                              name: s.setName,
                                              value: s.count,
                                          })),
                                          prevTypeData.setBonuses.map((s) => ({
                                              name: s.setName,
                                              value: s.count,
                                          }))
                                      )
                                    : null;
                                const rarityData = setsByTypeByRarity.find(
                                    (s) => s.type === typeData.type
                                );
                                return (
                                    <div key={typeData.type} className="flex flex-col">
                                        <h5 className="text-md font-semibold mb-2 text-center">
                                            {typeData.type}
                                        </h5>
                                        <BaseChart height={400}>
                                            <BarChart
                                                data={
                                                    chartData ||
                                                    rarityData?.data ||
                                                    typeData.setBonuses
                                                }
                                                layout="vertical"
                                                margin={{ left: 20 }}
                                            >
                                                <CartesianGrid
                                                    strokeDasharray="3 3"
                                                    stroke={colors.gridStroke}
                                                />
                                                <XAxis type="number" stroke={colors.axisStroke} />
                                                <YAxis
                                                    dataKey={
                                                        chartData
                                                            ? 'name'
                                                            : rarityData
                                                              ? 'name'
                                                              : 'setName'
                                                    }
                                                    type="category"
                                                    stroke={colors.axisStroke}
                                                    width={150}
                                                    interval={0}
                                                    style={{ fontSize: '11px' }}
                                                />
                                                <Tooltip
                                                    content={<ChartTooltip />}
                                                    cursor={{ fill: 'transparent' }}
                                                />
                                                {chartData ? (
                                                    <>
                                                        <Bar
                                                            dataKey="current"
                                                            name="Current"
                                                            fill="#3b82f6"
                                                        />
                                                        <Bar
                                                            dataKey="previous"
                                                            name="Previous"
                                                            fill="#6b7280"
                                                        />
                                                    </>
                                                ) : rarityData ? (
                                                    rarityData.rarities.map((rarity) => (
                                                        <Bar
                                                            key={rarity}
                                                            dataKey={rarity}
                                                            stackId="a"
                                                            fill={RARITY_COLORS[rarity]}
                                                            name={
                                                                rarity.charAt(0).toUpperCase() +
                                                                rarity.slice(1)
                                                            }
                                                        />
                                                    ))
                                                ) : (
                                                    <Bar dataKey="count" fill="#3b82f6" />
                                                )}
                                                {!chartData && rarityData && <Legend />}
                                            </BarChart>
                                        </BaseChart>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </div>

            {/* Detailed Table */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Implants by Type</h3>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-dark-border">
                                <th className="text-left py-2 text-theme-text-secondary">Type</th>
                                <th className="text-right py-2 text-theme-text-secondary">Count</th>
                                <th className="text-right py-2 text-theme-text-secondary">
                                    Percentage
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.byType.map((type) => (
                                <tr key={type.type} className="border-b border-dark-border">
                                    <td className="py-2">{type.type}</td>
                                    <td className="text-right py-2">{type.count}</td>
                                    <td className="text-right py-2">
                                        {type.percentage.toFixed(1)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
