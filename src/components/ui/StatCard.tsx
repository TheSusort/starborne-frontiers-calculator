import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'red';
    className?: string;
    previousValue?: number;
    positiveDirection?: 'up' | 'down';
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
    previousValue,
    positiveDirection = 'up',
}) => {
    const renderDelta = () => {
        if (previousValue === undefined) return null;
        const current = typeof value === 'number' ? value : parseFloat(value as string);
        if (isNaN(current)) return null;

        const rawDelta = current - previousValue;
        const delta = Math.round(rawDelta * 10) / 10;

        if (Math.abs(delta) < 0.1) {
            return (
                <span data-testid="stat-card-delta" className="text-xs text-gray-400 ml-1">
                    0
                </span>
            );
        }

        const isPositive = delta > 0;
        const isGood = positiveDirection === 'up' ? isPositive : !isPositive;

        const deltaClass = isGood ? 'text-green-400' : 'text-red-400';
        const sign = isPositive ? '+' : '';
        const displayValue = Number.isInteger(delta)
            ? delta
            : delta.toFixed(1).replace(/\.?0+$/, '');

        return (
            <span data-testid="stat-card-delta" className={`text-xs ${deltaClass} ml-1`}>
                {sign}
                {displayValue}
            </span>
        );
    };

    return (
        <div className={`card ${className}`}>
            <div className={icon ? 'flex items-center justify-between' : ''}>
                <div>
                    <div className="text-sm text-theme-text-secondary mb-1">{title}</div>
                    <div
                        className={`text-2xl font-bold ${colorClasses[color as keyof typeof colorClasses] ?? colorClasses.default}`}
                    >
                        {value}
                    </div>
                    {subtitle && (
                        <div className="text-xs text-theme-text-secondary mt-1">{subtitle}</div>
                    )}
                    {renderDelta()}
                </div>
                {icon && <div className="text-4xl opacity-50">{icon}</div>}
            </div>
        </div>
    );
};
