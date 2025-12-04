import React, { useMemo, useState } from 'react';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { RarityName } from '../../constants/rarities';
import { Select } from '../ui';
import { StatCard } from './StatCard';
import { calculateImplantStatistics, filterImplants } from '../../utils/statistics/implantsStats';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';

interface ImplantsStatsTabProps {
    gear: GearPiece[];
    ships: Ship[];
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

export const ImplantsStatsTab: React.FC<ImplantsStatsTabProps> = ({ gear, ships }) => {
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

    const typeChartData = stats.byType;

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
            <div className="card p-4">
                <h3 className="text-lg font-semibold mb-4">Filters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Implant Type</label>
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
                        <label className="block text-sm text-gray-400 mb-2">Rarity</label>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard title="Total Implants" value={stats.total} color="blue" />
                <StatCard
                    title="Equipped"
                    value={stats.equippedCount}
                    subtitle={`${stats.equippedPercentage.toFixed(1)}%`}
                    color="green"
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

                {/* Type Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Type Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={typeChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="type" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="count" fill="#8b5cf6" />
                        </BarChart>
                    </BaseChart>
                </div>
            </div>

            {/* Set Bonus Distribution by Type */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Set Bonus Distribution by Type</h3>

                {/* Minor Implants Row */}
                <div className="mb-6">
                    <h4 className="text-sm font-semibold mb-3 text-gray-400">Minor Implants</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {stats.setsByType
                            .filter((typeData) => typeData.type.startsWith('Minor'))
                            .map((typeData) => (
                                <div key={typeData.type} className="flex flex-col">
                                    <h5 className="text-md font-semibold mb-2 text-center">
                                        {typeData.type}
                                    </h5>
                                    <BaseChart height={300}>
                                        <BarChart
                                            data={typeData.setBonuses}
                                            layout="vertical"
                                            margin={{ left: 20 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                            <XAxis type="number" stroke="#9ca3af" />
                                            <YAxis
                                                dataKey="setName"
                                                type="category"
                                                stroke="#9ca3af"
                                                width={120}
                                                interval={0}
                                                style={{ fontSize: '10px' }}
                                            />
                                            <Tooltip
                                                content={<ChartTooltip />}
                                                cursor={{ fill: 'transparent' }}
                                            />
                                            <Bar dataKey="count" fill="#10b981" />
                                        </BarChart>
                                    </BaseChart>
                                </div>
                            ))}
                    </div>
                </div>

                {/* Major and Ultimate Row */}
                <div>
                    <h4 className="text-sm font-semibold mb-3 text-gray-400">
                        Major & Ultimate Implants
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {stats.setsByType
                            .filter(
                                (typeData) =>
                                    typeData.type === 'Major' || typeData.type === 'Ultimate'
                            )
                            .map((typeData) => (
                                <div key={typeData.type} className="flex flex-col">
                                    <h5 className="text-md font-semibold mb-2 text-center">
                                        {typeData.type}
                                    </h5>
                                    <BaseChart height={400}>
                                        <BarChart
                                            data={typeData.setBonuses}
                                            layout="vertical"
                                            margin={{ left: 20 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                            <XAxis type="number" stroke="#9ca3af" />
                                            <YAxis
                                                dataKey="setName"
                                                type="category"
                                                stroke="#9ca3af"
                                                width={150}
                                                interval={0}
                                                style={{ fontSize: '11px' }}
                                            />
                                            <Tooltip
                                                content={<ChartTooltip />}
                                                cursor={{ fill: 'transparent' }}
                                            />
                                            <Bar dataKey="count" fill="#3b82f6" />
                                        </BarChart>
                                    </BaseChart>
                                </div>
                            ))}
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
                                <th className="text-left py-2 text-gray-400">Type</th>
                                <th className="text-right py-2 text-gray-400">Count</th>
                                <th className="text-right py-2 text-gray-400">Percentage</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.byType.map((type) => (
                                <tr key={type.type} className="border-b border-gray-800">
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
