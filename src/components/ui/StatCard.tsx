import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'red';
    className?: string;
}

const colorClasses = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
    default: 'text-white',
};

export const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    subtitle,
    icon,
    color = 'default',
    className = '',
}) => {
    return (
        <div className={`card ${className}`}>
            <div className={icon ? 'flex items-center justify-between' : ''}>
                <div>
                    <div className="text-sm text-gray-400 mb-1">{title}</div>
                    <div
                        className={`text-2xl font-bold ${colorClasses[color as keyof typeof colorClasses] ?? colorClasses.default}`}
                    >
                        {value}
                    </div>
                    {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
                </div>
                {icon && <div className="text-4xl opacity-50">{icon}</div>}
            </div>
        </div>
    );
};
