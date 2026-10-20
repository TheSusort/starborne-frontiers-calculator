import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { BaseChart, ChartTooltip } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { TrafficSummary } from '../../services/trafficService';

interface TrafficChartProps {
    data: TrafficSummary['daily'];
    title: string;
}

export const TrafficChart: React.FC<TrafficChartProps> = ({ data, title }) => {
    const colors = useThemeColors();
    const chartData = data.map((d) => ({
        date: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        'Page Views': d.views,
        Visitors: d.visitors,
        Sessions: d.sessions,
    }));

    return (
        <div className="card">
            <h3 className="text-xl font-semibold mb-4">{title}</h3>
            <BaseChart height={300}>
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                    <XAxis dataKey="date" stroke={colors.axisStroke} />
                    <YAxis stroke={colors.axisStroke} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line
                        type="monotone"
                        dataKey="Page Views"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={{ fill: '#3B82F6' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="Visitors"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={{ fill: '#10B981' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="Sessions"
                        stroke="#F59E0B"
                        strokeWidth={2}
                        dot={{ fill: '#F59E0B' }}
                    />
                </LineChart>
            </BaseChart>
        </div>
    );
};
