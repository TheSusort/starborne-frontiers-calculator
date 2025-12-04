import React, { useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { ShipTypeName } from '../../constants';
import { RarityName } from '../../constants/rarities';
import { Select } from '../ui';
import { StatCard } from './StatCard';
import { calculateShipStatistics, filterShips } from '../../utils/statistics/shipsStats';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';

interface ShipsStatsTabProps {
    ships: Ship[];
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

const RARITY_COLORS: Record<string, string> = {
    common: '#9ca3af', // gray
    uncommon: '#22c55e', // green
    rare: '#3b82f6', // blue
    epic: '#a855f7', // purple
    legendary: '#f97316', // orange
};

export const ShipsStatsTab: React.FC<ShipsStatsTabProps> = ({ ships }) => {
    const [roleFilter, setRoleFilter] = useState<ShipTypeName | 'all'>('all');
    const [rarityFilter, setRarityFilter] = useState<RarityName | 'all'>('all');

    const filteredShips = useMemo(() => {
        return filterShips(ships, { role: roleFilter, rarity: rarityFilter });
    }, [ships, roleFilter, rarityFilter]);

    const stats = useMemo(() => {
        return calculateShipStatistics(filteredShips);
    }, [filteredShips]);

    // Prepare data for charts
    const rarityChartData = stats.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
        percentage: r.percentage.toFixed(1),
    }));

    const roleChartData = stats.byRole.map((r) => ({
        name: r.role,
        value: r.count,
        percentage: r.percentage.toFixed(1),
    }));

    const levelChartData = stats.levels;

    const refitsByRarityData = stats.refits.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
    }));

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="card p-4">
                <h3 className="text-lg font-semibold mb-4">Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Ship Role</label>
                        <Select
                            value={roleFilter}
                            onChange={(value) => setRoleFilter(value as ShipTypeName | 'all')}
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
                        <label className="block text-sm text-gray-400 mb-2">Ship Rarity</label>
                        <Select
                            value={rarityFilter}
                            onChange={(value) => setRarityFilter(value as RarityName | 'all')}
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
                <StatCard title="Total Ships" value={stats.total} color="blue" />
                <StatCard
                    title="Average Level"
                    value={stats.averageLevel.toFixed(1)}
                    color="green"
                />
                <StatCard
                    title="Max Level Ships"
                    value={stats.maxLevelCount}
                    subtitle={`${stats.maxLevelPercentage.toFixed(1)}% of fleet`}
                    color="yellow"
                />
                <StatCard
                    title="Total Refits"
                    value={stats.refits.total}
                    subtitle={`Avg: ${stats.refits.average.toFixed(1)} per ship`}
                    color="purple"
                />
            </div>

            {/* Additional Insights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="With Implants"
                    value={stats.withImplantsCount}
                    subtitle={`${stats.withImplantsPercentage.toFixed(1)}%`}
                    color="blue"
                />
                <StatCard
                    title="Fully Geared"
                    value={stats.fullyGearedCount}
                    subtitle={`${stats.fullyGearedPercentage.toFixed(1)}%`}
                    color="green"
                />
                <StatCard
                    title="Ungeared"
                    value={stats.ungearedCount}
                    subtitle={`${stats.ungearedPercentage.toFixed(1)}%`}
                    color="orange"
                />
                <StatCard title="Factions" value={stats.byFaction.length} color="purple" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Rarity Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Rarity Distribution</h3>
                    <BaseChart height={300}>
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
                    </BaseChart>
                </div>

                {/* Role Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Role Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={roleChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="value" fill="#3b82f6" />
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Level Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={levelChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="range" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="count" fill="#10b981" />
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Refits by Rarity */}
                {refitsByRarityData.length > 0 && (
                    <div className="card">
                        <h3 className="text-lg font-semibold mb-4">Refits by Rarity</h3>
                        <BaseChart height={300}>
                            <BarChart data={refitsByRarityData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis dataKey="name" stroke="#9ca3af" />
                                <YAxis stroke="#9ca3af" />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="value" fill="#f59e0b" />
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
                                    <th className="text-left py-2 text-gray-400">Faction</th>
                                    <th className="text-right py-2 text-gray-400">Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.byFaction.map((faction) => (
                                    <tr key={faction.faction} className="border-b border-gray-800">
                                        <td className="py-2">{faction.faction}</td>
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
