import React, { useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Ship } from '../../types/ship';
import { ShipTypeName, SHIP_TYPES, FACTIONS } from '../../constants';
import { RarityName, RARITY_ORDER } from '../../constants/rarities';
import { Select, StatCard } from '../ui';
import { calculateShipStatistics, filterShips } from '../../utils/statistics/shipsStats';
import { BaseChart, ChartTooltip } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ShipsSnapshot } from '../../types/statisticsSnapshot';
import { mergeDistributions } from '../../utils/statistics/mergeDistributions';

interface ShipsStatsTabProps {
    ships: Ship[];
    previousStats?: ShipsSnapshot;
}

// Colors for charts
const CHART_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ef4444', // red
    '#06b6d4', // cyan
    '#f97316', // orange
    '#ec4899', // pink
];

const ROLE_COLORS: Record<string, string> = {
    Attacker: '#ef4444', // red
    Defender: '#3b82f6', // blue
    Debuffer: '#a855f7', // purple
    Supporter: '#10b981', // green
};

const getRoleColor = (name: string) => {
    const base = name.split('(')[0].trim();
    return ROLE_COLORS[base] ?? '#6b7280';
};

const RARITY_COLORS: Record<string, string> = {
    common: '#d1d5db',
    uncommon: '#a3e635',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f59e0b',
};

export const ShipsStatsTab: React.FC<ShipsStatsTabProps> = ({ ships, previousStats }) => {
    const colors = useThemeColors();
    const [roleFilter, setRoleFilter] = useState<ShipTypeName | 'all'>('all');
    const [rarityFilter, setRarityFilter] = useState<RarityName | 'all'>('all');

    const filteredShips = useMemo(() => {
        return filterShips(ships, { role: roleFilter, rarity: rarityFilter });
    }, [ships, roleFilter, rarityFilter]);

    const stats = useMemo(() => {
        return calculateShipStatistics(filteredShips);
    }, [filteredShips]);

    // Prepare data for charts
    const rarityChartData = stats.byRarity
        .slice()
        .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
        .map((r) => ({
            name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
            value: r.count,
            percentage: r.percentage.toFixed(1),
        }));

    const getRoleLabel = (role: string) => SHIP_TYPES[role]?.name || role;
    const roleCurrentData = stats.byRole.map((r) => ({
        name: getRoleLabel(r.role),
        value: r.count,
    }));
    const roleChartData = previousStats
        ? mergeDistributions(
              roleCurrentData,
              (previousStats.byRole ?? []).map((r) => ({
                  name: getRoleLabel(r.role),
                  value: r.count,
              }))
          )
        : stats.byRole.map((r) => ({
              name: getRoleLabel(r.role),
              value: r.count,
              percentage: r.percentage.toFixed(1),
          }));

    const levelCurrentData = stats.levels.map((l) => ({ name: l.range, value: l.count }));
    const levelChartData = previousStats
        ? mergeDistributions(
              levelCurrentData,
              (previousStats.levels ?? []).map((l) => ({ name: l.range, value: l.count }))
          )
        : stats.levels;

    const rarityBarData = previousStats
        ? mergeDistributions(
              rarityChartData,
              (previousStats.byRarity ?? []).map((r) => ({
                  name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
                  value: r.count,
              }))
          )
        : rarityChartData;

    const refitsCurrentData = stats.refits.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
    }));
    const refitsByRarityData = previousStats
        ? mergeDistributions(
              refitsCurrentData,
              (previousStats.refits?.byRarity ?? []).map((r) => ({
                  name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
                  value: r.count,
              }))
          )
        : refitsCurrentData;

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Ship Role
                        </label>
                        <Select
                            value={roleFilter}
                            onChange={(value) => setRoleFilter(value)}
                            options={[
                                { value: 'all', label: 'All Roles' },
                                { value: 'ATTACKER', label: 'Attacker' },
                                { value: 'DEFENDER', label: 'Defender' },
                                { value: 'SUPPORTER', label: 'Supporter' },
                                { value: 'DEBUFFER', label: 'Debuffer' },
                            ]}
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-2">
                            Ship Rarity
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
                    title="Total Ships"
                    value={stats.total}
                    color="blue"
                    previousValue={previousStats?.total}
                />
                <StatCard
                    title="Average Level"
                    value={stats.averageLevel.toFixed(1)}
                    color="green"
                    previousValue={previousStats?.averageLevel}
                />
                <StatCard
                    title="Max Level Ships"
                    value={stats.maxLevelCount}
                    subtitle={`${stats.maxLevelPercentage.toFixed(1)}% of fleet`}
                    color="yellow"
                    previousValue={previousStats?.maxLevelCount}
                />
                <StatCard
                    title="Total Refits"
                    value={stats.refits.total}
                    subtitle={`Avg: ${stats.refits.average.toFixed(1)} per ship`}
                    color="purple"
                    previousValue={previousStats?.refits.total}
                />
            </div>

            {/* Additional Insights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="With Implants"
                    value={stats.withImplantsCount}
                    subtitle={`${stats.withImplantsPercentage.toFixed(1)}%`}
                    color="blue"
                    previousValue={previousStats?.withImplantsCount}
                />
                <StatCard
                    title="Fully Geared"
                    value={stats.fullyGearedCount}
                    subtitle={`${stats.fullyGearedPercentage.toFixed(1)}%`}
                    color="green"
                    previousValue={previousStats?.fullyGearedCount}
                />
                <StatCard
                    title="Ungeared"
                    value={stats.ungearedCount}
                    subtitle={`${stats.ungearedPercentage.toFixed(1)}%`}
                    color="orange"
                    previousValue={previousStats?.ungearedCount}
                    positiveDirection="down"
                />
                <StatCard
                    title="Factions"
                    value={stats.byFaction.length}
                    color="purple"
                    previousValue={previousStats?.byFaction.length}
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Rarity Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Rarity Distribution</h3>
                    <BaseChart height={300}>
                        {previousStats ? (
                            <BarChart data={rarityBarData}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="current" name="Current">
                                    {rarityBarData.map((entry, index) => (
                                        <Cell
                                            key={`current-${index}`}
                                            fill={
                                                RARITY_COLORS[entry.name.toLowerCase()] || '#3b82f6'
                                            }
                                        />
                                    ))}
                                </Bar>
                                <Bar dataKey="previous" name="Previous">
                                    {rarityBarData.map((entry, index) => (
                                        <Cell
                                            key={`previous-${index}`}
                                            fill={
                                                (RARITY_COLORS[entry.name.toLowerCase()] ||
                                                    '#3b82f6') + '66'
                                            }
                                        />
                                    ))}
                                </Bar>
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

                {/* Role Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Role Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={roleChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis dataKey="name" stroke={colors.axisStroke} />
                            <YAxis stroke={colors.axisStroke} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" name="Current">
                                        {roleChartData.map((entry, index) => (
                                            <Cell
                                                key={`current-${index}`}
                                                fill={getRoleColor(entry.name)}
                                            />
                                        ))}
                                    </Bar>
                                    <Bar dataKey="previous" name="Previous">
                                        {roleChartData.map((entry, index) => (
                                            <Cell
                                                key={`previous-${index}`}
                                                fill={getRoleColor(entry.name) + '66'}
                                            />
                                        ))}
                                    </Bar>
                                </>
                            ) : (
                                <Bar dataKey="value">
                                    {roleChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={getRoleColor(entry.name)}
                                        />
                                    ))}
                                </Bar>
                            )}
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Level Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={levelChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                            <XAxis
                                dataKey={previousStats ? 'name' : 'range'}
                                stroke={colors.axisStroke}
                            />
                            <YAxis stroke={colors.axisStroke} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            {previousStats ? (
                                <>
                                    <Bar dataKey="current" fill="#10b981" name="Current" />
                                    <Bar dataKey="previous" fill="#10b98166" name="Previous" />
                                </>
                            ) : (
                                <Bar dataKey="count" fill="#10b981" />
                            )}
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Refits by Rarity */}
                {refitsByRarityData.length > 0 && (
                    <div className="card">
                        <h3 className="text-lg font-semibold mb-4">Refits by Rarity</h3>
                        <BaseChart height={300}>
                            <BarChart data={refitsByRarityData}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                                <XAxis dataKey="name" stroke={colors.axisStroke} />
                                <YAxis stroke={colors.axisStroke} />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                {previousStats ? (
                                    <>
                                        <Bar dataKey="current" name="Current">
                                            {refitsByRarityData.map((entry, index) => (
                                                <Cell
                                                    key={`current-${index}`}
                                                    fill={
                                                        RARITY_COLORS[entry.name.toLowerCase()] ||
                                                        '#f59e0b'
                                                    }
                                                />
                                            ))}
                                        </Bar>
                                        <Bar dataKey="previous" name="Previous">
                                            {refitsByRarityData.map((entry, index) => (
                                                <Cell
                                                    key={`previous-${index}`}
                                                    fill={
                                                        (RARITY_COLORS[entry.name.toLowerCase()] ||
                                                            '#f59e0b') + '66'
                                                    }
                                                />
                                            ))}
                                        </Bar>
                                    </>
                                ) : (
                                    <Bar dataKey="value">
                                        {refitsByRarityData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={
                                                    RARITY_COLORS[entry.name.toLowerCase()] ||
                                                    '#f59e0b'
                                                }
                                            />
                                        ))}
                                    </Bar>
                                )}
                            </BarChart>
                        </BaseChart>
                    </div>
                )}
            </div>

            {/* Faction Table */}
            {stats.byFaction.length > 0 && (
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Ships by Faction</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-dark-border">
                                    <th className="text-left py-2 text-theme-text-secondary">
                                        Faction
                                    </th>
                                    <th className="text-right py-2 text-theme-text-secondary">
                                        Count
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.byFaction.map((faction) => (
                                    <tr
                                        key={faction.faction}
                                        className="border-b border-dark-border"
                                    >
                                        <td className="py-2">
                                            {FACTIONS[faction.faction]?.name || faction.faction}
                                        </td>
                                        <td className="text-right py-2">{faction.count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
