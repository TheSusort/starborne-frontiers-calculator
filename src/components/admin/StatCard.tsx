import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'yellow' | 'purple';
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color = 'blue' }) => {
    return (
        <div
            className={`p-6 border border-dark-border hover:border-primary bg-dark transition-all hover:scale-105`}
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
