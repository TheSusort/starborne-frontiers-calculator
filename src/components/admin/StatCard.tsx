import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'yellow' | 'purple';
}

const colorClasses = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color = 'blue' }) => {
    return (
        <div
            className={`p-6 border ${colorClasses[color]} bg-dark-lighter transition-all hover:scale-105`}
        >
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-gray-400 mb-1">{title}</p>
                    <p className="text-3xl font-bold">{value}</p>
                </div>
                {icon && <div className="text-4xl opacity-50">{icon}</div>}
            </div>
        </div>
    );
};
