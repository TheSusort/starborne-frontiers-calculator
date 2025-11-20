import React, { useMemo } from 'react';
import { EngineeringStat } from '../../types/stats';
import { StatCard } from './StatCard';
import { calculateEngineeringStatistics } from '../../utils/statistics/engineeringStats';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

interface EngineeringStatsTabProps {
    engineeringStats: EngineeringStat[];
}

const CHART_COLORS = [
    '#3b82f6', // HP
    '#ef4444', // Attack
    '#10b981', // Defence
    '#f59e0b', // Speed
    '#8b5cf6', // Hacking
    '#06b6d4', // Other
];

export const EngineeringStatsTab: React.FC<EngineeringStatsTabProps> = ({ engineeringStats }) => {
    const stats = useMemo(() => {
        return calculateEngineeringStatistics(engineeringStats);
    }, [engineeringStats]);

    // Prepare data for points by role chart
    const roleChartData = stats.byRole.map((role) => ({
        name: role.role,
        points: role.totalPoints,
    }));

    // Prepare data for stacked bar chart (points by stat type per role)
    const stackedChartData = stats.byRole.map((role) => {
        const data: Record<string, string | number> = { name: role.role };
        role.byStatType.forEach((stat) => {
            data[stat.statName] = stat.points;
        });
        return data;
    });

    // Get all unique stat names for the legend
    const allStatNames = useMemo(() => {
        const names = new Set<string>();
        stats.byRole.forEach((role) => {
            role.byStatType.forEach((stat) => {
                names.add(stat.statName);
            });
        });
        return Array.from(names);
    }, [stats.byRole]);

    // Empty state
    if (stats.totalPoints === 0) {
        return (
            <div className="bg-dark-lighter p-12 border border-gray-700 rounded text-center">
                <div className="text-gray-400 text-lg">No engineering points invested yet.</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Total Points"
                    value={stats.totalPoints.toLocaleString()}
                    color="blue"
                />
                <StatCard
                    title="Average Per Role"
                    value={stats.averagePointsPerRole.toFixed(0)}
                    color="green"
                />
                <StatCard
                    title="Most Invested"
                    value={stats.mostInvestedRole?.role || 'N/A'}
                    subtitle={`${stats.mostInvestedRole?.points || 0} points`}
                    color="yellow"
                />
                <StatCard
                    title="Roles with 0 Points"
                    value={stats.rolesWithZeroInvestment.length}
                    color="red"
                />
            </div>

            {/* Charts */}
            <div className="space-y-6">
                {/* Points by Role */}
                <div className="bg-dark-lighter p-6 border border-gray-700 rounded">
                    <h3 className="text-lg font-semibold mb-4">Points by Role</h3>
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={roleChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis type="number" stroke="#9ca3af" />
                            <YAxis dataKey="name" type="category" stroke="#9ca3af" width={150} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1f2937',
                                    border: '1px solid #374151',
                                }}
                                cursor={{ fill: 'transparent' }}
                            />
                            <Bar dataKey="points" fill="#3b82f6" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Stat Type Breakdown */}
                <div className="bg-dark-lighter p-6 border border-gray-700 rounded">
                    <h3 className="text-lg font-semibold mb-4">Point Distribution by Stat Type</h3>
                    <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={stackedChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="name" stroke="#9ca3af" />
                            <YAxis stroke="#9ca3af" />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1f2937',
                                    border: '1px solid #374151',
                                }}
                                cursor={{ fill: 'transparent' }}
                            />
                            <Legend />
                            {allStatNames.map((statName, index) => (
                                <Bar
                                    key={statName}
                                    dataKey={statName}
                                    stackId="a"
                                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Detailed Table */}
            <div className="bg-dark-lighter p-6 border border-gray-700 rounded">
                <h3 className="text-lg font-semibold mb-4">Detailed Investment Table</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left py-2 text-gray-400">Role</th>
                                {allStatNames.map((statName) => (
                                    <th
                                        key={statName}
                                        className="text-right py-2 px-2 text-gray-400"
                                    >
                                        {statName}
                                    </th>
                                ))}
                                <th className="text-right py-2 text-gray-400 font-bold">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.byRole.map((role) => {
                                const statMap = new Map(
                                    role.byStatType.map((s) => [s.statName, s.points])
                                );
                                return (
                                    <tr key={role.role} className="border-b border-gray-800">
                                        <td className="py-2">{role.role}</td>
                                        {allStatNames.map((statName) => (
                                            <td key={statName} className="text-right py-2 px-2">
                                                {statMap.get(statName) || 0}
                                            </td>
                                        ))}
                                        <td className="text-right py-2 font-bold text-yellow-400">
                                            {role.totalPoints}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Zero Investment Warning */}
            {stats.rolesWithZeroInvestment.length > 0 && (
                <div className="bg-red-900/20 border border-red-700 p-4 rounded">
                    <h4 className="text-red-400 font-semibold mb-2">Roles with No Investment</h4>
                    <div className="text-gray-300">{stats.rolesWithZeroInvestment.join(', ')}</div>
                </div>
            )}
        </div>
    );
};
