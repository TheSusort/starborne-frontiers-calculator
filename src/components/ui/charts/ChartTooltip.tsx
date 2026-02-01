import React from 'react';

interface ChartTooltipProps {
    active?: boolean;
    payload?: Array<{
        payload?: Record<string, unknown>;
        value?: number | string;
        dataKey?: string;
        name?: string;
        color?: string;
    }>;
    label?: string | number;
    formatter?: (value: number | string, name: string) => React.ReactNode;
    labelFormatter?: (
        label: string | number,
        payload?: ChartTooltipProps['payload']
    ) => React.ReactNode;
    className?: string;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({
    active,
    payload,
    label,
    formatter,
    labelFormatter,
    className = '',
}) => {
    if (!active || !payload || payload.length === 0) {
        return null;
    }

    return (
        <div className={`bg-dark-lighter p-2 border border-dark-border text-white ${className}`}>
            {label !== undefined && (
                <p className="font-bold mb-2">
                    {labelFormatter ? labelFormatter(label, payload) : label}
                </p>
            )}
            {payload.map((entry, index) => {
                if (!entry.dataKey && !entry.name) return null;

                const name = entry.name || entry.dataKey || '';
                const value = entry.value ?? '';

                return (
                    <p key={index} className="text-sm">
                        {formatter && typeof value === 'number'
                            ? formatter(value, name)
                            : `${name}: ${value}`}
                    </p>
                );
            })}
        </div>
    );
};
