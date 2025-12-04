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
    const chartData = [...data].reverse().map((stat) => ({
        date: new Date(stat.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        }),
        'Autogear Runs': stat.total_autogear_runs,
        'Data Imports': stat.total_data_imports,
        'Active Users': stat.unique_active_users,
    }));

    return (
        <div className="bg-dark p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-4">{title}</h3>
            <BaseChart height={300}>
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" />
                    <YAxis stroke="#9CA3AF" />
                    <Tooltip content={<ChartTooltip />} />
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
