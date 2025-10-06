import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { UserDistribution } from '../../services/systemHealthService';

interface UserDistributionChartProps {
    data: UserDistribution[];
}

const COLORS = {
    'Power User': '#8B5CF6',
    Heavy: '#3B82F6',
    Moderate: '#10B981',
    Light: '#F59E0B',
    Inactive: '#6B7280',
};

export const UserDistributionChart: React.FC<UserDistributionChartProps> = ({ data }) => {
    const chartData = data.map((item) => ({
        name: item.activity_level,
        value: item.user_count,
        percentage: item.percentage,
    }));

    const renderCustomLabel = ({
        cx,
        cy,
        midAngle,
        innerRadius,
        outerRadius,
        percent,
    }: {
        cx: number;
        cy: number;
        midAngle: number;
        innerRadius: number;
        outerRadius: number;
        percent: number;
    }) => {
        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
        const x = cx + radius * Math.cos((-midAngle * Math.PI) / 180);
        const y = cy + radius * Math.sin((-midAngle * Math.PI) / 180);

        if (percent < 0.05) return null; // Don't show label if less than 5%

        return (
            <text
                x={x}
                y={y}
                fill="white"
                textAnchor={x > cx ? 'start' : 'end'}
                dominantBaseline="central"
                className="text-xs font-semibold"
            >
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    return (
        <div className="bg-dark-lighter p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-4">User Distribution by Activity</h3>
            <div className="flex flex-col md:flex-row items-center gap-4">
                <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={renderCustomLabel}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                        >
                            {chartData.map((entry) => (
                                <Cell
                                    key={`cell-${entry.name}`}
                                    fill={COLORS[entry.name as keyof typeof COLORS]}
                                />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#1F2937',
                                border: '1px solid #374151',
                                borderRadius: '0.375rem',
                            }}
                            formatter={(value: number, name: string, item) => [
                                `${value} users (${item.payload?.percentage ?? 0}%)`,
                                name,
                            ]}
                        />
                        <Legend
                            verticalAlign="bottom"
                            height={36}
                            formatter={(value) => (
                                <span className="text-gray-300 text-sm">{value}</span>
                            )}
                        />
                    </PieChart>
                </ResponsiveContainer>

                {/* Stats breakdown */}
                <div className="flex-1 space-y-2">
                    {data.map((item) => (
                        <div
                            key={item.activity_level}
                            className="flex items-center justify-between p-2 bg-dark"
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{
                                        backgroundColor:
                                            COLORS[item.activity_level as keyof typeof COLORS],
                                    }}
                                />
                                <span className="text-sm text-gray-300">{item.activity_level}</span>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-semibold text-white">
                                    {item.user_count}
                                </div>
                                <div className="text-xs text-gray-500">{item.percentage}%</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
