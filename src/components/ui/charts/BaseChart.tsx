import React, { ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';

interface BaseChartProps {
    children: ReactElement;
    height?: number;
    className?: string;
    error?: Error | null;
    errorFallback?: ReactNode;
}

export const BaseChart: React.FC<BaseChartProps> = ({
    children,
    height = 400,
    className = '',
    error,
    errorFallback,
}) => {
    if (error && errorFallback) {
        return <>{errorFallback}</>;
    }

    return (
        <div className={className} style={{ width: '100%', height }}>
            <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
    );
};

export const DefaultErrorFallback: React.FC<{ title?: string; message?: string }> = ({
    title = 'Chart Error',
    message = 'There was an error rendering the chart.',
}) => (
    <div className="bg-dark p-4 border border-red-500">
        <h3 className="text-lg font-bold text-red-500 mb-2">{title}</h3>
        <p className="mb-2">{message}</p>
    </div>
);
