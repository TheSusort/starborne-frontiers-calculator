import React, { useMemo, useState } from 'react';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { GearSetName } from '../../constants';
import { RarityName } from '../../constants/rarities';
import { Select } from '../ui';
import { StatCard } from '../ui';
import { calculateGearStatistics, filterGear } from '../../utils/statistics/gearStats';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';

interface GearStatsTabProps {
    gear: GearPiece[];
    ships: Ship[];
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

export const GearStatsTab: React.FC<GearStatsTabProps> = ({ gear, ships }) => {
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
    const setChartData = stats.bySet.slice(0, 10); // Top 10 sets

    const mainStatChartData = stats.byMainStat.slice(0, 10).map((s) => ({
        name: `${s.statName} (${s.statType})`,
        value: s.count,
        category: s.category,
    }));

    const rarityChartData = stats.byRarity.map((r) => ({
        name: r.rarity.charAt(0).toUpperCase() + r.rarity.slice(1),
        value: r.count,
    }));

    const starChartData = stats.byStarLevel;
    const levelChartData = stats.byLevel;

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
                        <label className="block text-sm text-gray-400 mb-2">Gear Set</label>
                        <Select
                            value={setFilter}
                            onChange={(value) =>
                                setSetFilter(value as GearSetName | 'all' | 'none')
                            }
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
                        <label className="block text-sm text-gray-400 mb-2">Main Stat</label>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Total Gear" value={stats.total} color="blue" />
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
                    color="yellow"
                />
                <StatCard
                    title="Avg Level"
                    value={stats.averageLevel.toFixed(1)}
                    subtitle={`Avg Stars: ${stats.averageStarLevel.toFixed(1)}`}
                    color="purple"
                />
            </div>

            {/* Additional Insights */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard
                    title="Max Level"
                    value={stats.maxLevelCount}
                    subtitle={`${stats.maxLevelPercentage.toFixed(1)}%`}
                    color="blue"
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis type="number" stroke="#9ca3af" />
                            <YAxis
                                dataKey="setName"
                                type="category"
                                stroke="#9ca3af"
                                width={100}
                                interval={0}
                                style={{ fontSize: '11px' }}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="count" fill="#3b82f6" />
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Main Stat Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Top 10 Main Stats</h3>
                    <BaseChart height={300}>
                        <BarChart data={mainStatChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis type="number" stroke="#9ca3af" />
                            <YAxis
                                dataKey="name"
                                type="category"
                                stroke="#9ca3af"
                                width={120}
                                interval={0}
                                style={{ fontSize: '11px' }}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="value" fill="#10b981" />
                        </BarChart>
                    </BaseChart>
                </div>

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

                {/* Star Level Distribution */}
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Star Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={starChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="stars" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="count" fill="#f59e0b" />
                        </BarChart>
                    </BaseChart>
                </div>

                {/* Level Distribution */}
                <div className="card lg:col-span-2">
                    <h3 className="text-lg font-semibold mb-4">Level Distribution</h3>
                    <BaseChart height={300}>
                        <BarChart data={levelChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="range" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                            <Bar dataKey="count" fill="#8b5cf6" />
                        </BarChart>
                    </BaseChart>
                </div>
            </div>

            {/* Slot Distribution Table */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Gear by Slot</h3>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-dark-border">
                                <th className="text-left py-2 text-gray-400">Slot</th>
                                <th className="text-right py-2 text-gray-400">Count</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.bySlot.map((slot) => (
                                <tr key={slot.slot} className="border-b border-gray-800">
                                    <td className="py-2">{slot.slot}</td>
                                    <td className="text-right py-2">{slot.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
