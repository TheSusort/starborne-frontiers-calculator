import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { GrowthMetric } from '../../services/systemHealthService';
import { BaseChart, ChartTooltip } from '../ui/charts';

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
        <div className="card">
            <h3 className="text-xl font-semibold mb-4">{title}</h3>
            <BaseChart height={300}>
                <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip content={<ChartTooltip />} />
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
            </BaseChart>
        </div>
    );
};
