import React from 'react';
import { Loader } from './Loader';

interface ProgressBarProps {
    current: number;
    total: number;
    percentage?: number;
    className?: string;
    label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    current,
    total,
    className = '',
    label = '',
    percentage = 0,
}) => {
    percentage = percentage || Math.min(Math.max(current / total, 0), 1) * 100;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
                className={`w-full max-w-lg mx-4 bg-dark-lighter p-6 shadow-lg ${className}`}
                role="progressbar"
                aria-valuenow={current}
                aria-valuemax={total}
            >
                <Loader size="sm" />
                {label && <label className="text-sm text-gray-400">{label}</label>}
                <div className="flex justify-between mb-1">
                    <span className="text-sm text-gray-400">
                        Progress: {current.toLocaleString()} / {total.toLocaleString()}
                    </span>
                    <span className="text-sm text-gray-400">{percentage}%</span>
                </div>
                <div className="w-full bg-gray-700 h-2.5">
                    <div
                        className="bg-gradient-to-r from-amber-700 via-primary to-amber-700 h-2.5"
                        data-testid="progress-fill"
                        style={{ width: `${percentage}%` }}
                    />
                </div>
            </div>
        </div>
    );
};
