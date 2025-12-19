import React from 'react';

interface ArcaneSiegeInfo {
    multiplier: number;
    isShielded: boolean;
    shieldedDamage: number | null;
}

interface SimulationStatDisplayProps {
    label: string;
    value: string | number;
    formatValue?: (value: string | number) => string;
    currentValue?: number;
    suggestedValue?: number;
    showComparison?: boolean;
    comparisonType?: 'percentage' | 'absolute';
    arcaneSiegeInfo?: ArcaneSiegeInfo;
}

/**
 * Calculates the percentage difference between two values
 */
const calculatePercentageDiff = (suggested: number, current: number): number => {
    if (current === 0) return 0;
    return ((suggested - current) / current) * 100;
};

/**
 * Formats a comparison value based on type
 */
const formatComparison = (
    suggested: number,
    current: number,
    type: 'percentage' | 'absolute'
): string => {
    if (type === 'percentage') {
        return `${calculatePercentageDiff(suggested, current).toFixed(1)}%`;
    }
    return `(${(suggested - current).toFixed(1)})`;
};

export const SimulationStatDisplay: React.FC<SimulationStatDisplayProps> = ({
    label,
    value,
    formatValue,
    currentValue,
    suggestedValue,
    showComparison = false,
    comparisonType = 'percentage',
    arcaneSiegeInfo,
}) => {
    const displayValue = formatValue ? formatValue(value) : String(value);
    const isImprovement =
        showComparison &&
        currentValue !== undefined &&
        suggestedValue !== undefined &&
        suggestedValue > currentValue;

    // Only show Arcane Siege info for "Average Damage" label
    const showArcaneSiege = arcaneSiegeInfo && label === 'Average Damage';

    return (
        <div>
            <span className="text-gray-400">{label}:</span>
            <span className="ml-2">{displayValue}</span>
            {showComparison && currentValue !== undefined && suggestedValue !== undefined && (
                <span className={`ml-2 ${isImprovement ? 'text-green-500' : 'text-red-500'}`}>
                    ({formatComparison(suggestedValue, currentValue, comparisonType)})
                </span>
            )}
            {showArcaneSiege && (
                <>
                    <span className="ml-2 text-blue-400">(if shielded)</span>
                    {arcaneSiegeInfo.shieldedDamage !== null && (
                        <span className="ml-2 text-blue-400">
                            {formatValue
                                ? formatValue(arcaneSiegeInfo.shieldedDamage)
                                : arcaneSiegeInfo.shieldedDamage.toLocaleString()}
                        </span>
                    )}
                </>
            )}
        </div>
    );
};
