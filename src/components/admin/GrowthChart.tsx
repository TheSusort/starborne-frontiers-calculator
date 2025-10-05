import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import { GrowthMetric } from '../../services/systemHealthService';

interface GrowthChartProps {
    data: GrowthMetric[];
    title: string;
}

export const GrowthChart: React.FC<GrowthChartProps> = ({ data, title }) => {
    // Format data for the chart (reverse to show oldest to newest)
    const chartData = [...data].reverse().map((metric) => ({
        date: new Date(metric.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        }),
        Ships: metric.new_ships,
        Gear: metric.new_gear,
        Loadouts: metric.new_loadouts,
        Users: metric.new_users,
    }));

    return (
        <div className="bg-dark-lighter p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-4">{title}</h3>
            <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#1F2937',
                            border: '1px solid #374151',
                            borderRadius: '0.375rem',
                        }}
                        labelStyle={{ color: '#F9FAFB' }}
                    />
                    <Legend />
                    <Area
                        type="monotone"
                        dataKey="Ships"
                        stackId="1"
                        stroke="#3B82F6"
                        fill="#3B82F6"
                        fillOpacity={0.6}
                    />
                    <Area
                        type="monotone"
                        dataKey="Gear"
                        stackId="1"
                        stroke="#10B981"
                        fill="#10B981"
                        fillOpacity={0.6}
                    />
                    <Area
                        type="monotone"
                        dataKey="Loadouts"
                        stackId="1"
                        stroke="#F59E0B"
                        fill="#F59E0B"
                        fillOpacity={0.6}
                    />
                    <Area
                        type="monotone"
                        dataKey="Users"
                        stackId="1"
                        stroke="#8B5CF6"
                        fill="#8B5CF6"
                        fillOpacity={0.6}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
