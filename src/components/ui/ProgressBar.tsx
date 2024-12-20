import React from 'react';

interface ProgressBarProps {
    current: number;
    total: number;
    percentage: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    current,
    total,
    percentage
}) => {
    return (
        <div className="w-full">
            <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">
                    Progress: {current.toLocaleString()} / {total.toLocaleString()}
                </span>
                <span className="text-sm text-gray-400">{percentage}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2.5">
                <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}; 