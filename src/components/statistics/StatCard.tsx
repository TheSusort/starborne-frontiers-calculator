import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    color?: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'red';
}

const colorClasses = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
};

export const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, color = 'blue' }) => {
    return (
        <div className="bg-dark p-4 border border-gray-700">
            <div className="text-sm text-gray-400 mb-2">{title}</div>
            <div className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</div>
            {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
        </div>
    );
};
