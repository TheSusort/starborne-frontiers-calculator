import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { DailyUsageStat } from '../../services/adminService';
import { BaseChart, ChartTooltip } from '../ui/charts';

interface UsageChartProps {
    data: DailyUsageStat[];
    title: string;
}

export const UsageChart: React.FC<UsageChartProps> = ({ data, title }) => {
    // Format data for the chart (reverse to show oldest to newest)
    const chartData = [...data].reverse().map((stat) => {
        const dateObj = new Date(stat.date);
        return {
            date: dateObj.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
            }),
            weekday: dateObj.toLocaleDateString('en-US', { weekday: 'long' }),
            'Autogear Runs': stat.total_autogear_runs,
            'Data Imports': stat.total_data_imports,
            'Active Users': stat.unique_active_users,
        };
    });

    const labelFormatter = (
        label: string | number,
        payload?: Array<{ payload?: Record<string, unknown> }>
    ) => {
        const weekday = payload?.[0]?.payload?.weekday;
        return weekday ? `${weekday}, ${label}` : label;
    };

    return (
        <div className="card">
            <h3 className="text-xl font-semibold mb-4">{title}</h3>
            <BaseChart height={300}>
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip content={<ChartTooltip labelFormatter={labelFormatter} />} />
                    <Legend />
                    <Line
                        type="monotone"
                        dataKey="Autogear Runs"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={{ fill: '#3B82F6' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="Data Imports"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={{ fill: '#10B981' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="Active Users"
                        stroke="#F59E0B"
                        strokeWidth={2}
                        dot={{ fill: '#F59E0B' }}
                    />
                </LineChart>
            </BaseChart>
        </div>
    );
};
