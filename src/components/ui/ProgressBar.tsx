import React from 'react';

interface ProgressBarProps {
    current: number;
    total: number;
    className?: string;
    label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    current,
    total,
    className = '',
    label = ''
}) => {
    const percentage = Math.min(Math.max(current / total, 0), 1) * 100;
    return (
        <div className={`w-full ${className}`} role="progressbar" aria-valuenow={current} aria-valuemax={total}>
            {label && <label className="text-sm text-gray-400">{label}</label>}
            <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">
                    Progress: {current.toLocaleString()} / {total.toLocaleString()}
                </span>
                <span className="text-sm text-gray-400">{percentage}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2.5">
                <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    data-testid="progress-fill"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
};