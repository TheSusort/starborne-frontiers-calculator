import React from 'react';

interface MeterBarProps {
    /** Fill in percent; clamped to 0..100. */
    percentage: number;
    /** Accessible name, e.g. "Hull". */
    label: string;
    /** Tailwind background class for the fill. */
    fillClassName?: string;
    className?: string;
}

/** An inline horizontal meter (HP, charge). `ProgressBar` is a blocking loader overlay instead. */
export const MeterBar: React.FC<MeterBarProps> = ({
    percentage,
    label,
    fillClassName = 'bg-green-500',
    className = '',
}) => {
    const pct = Math.min(100, Math.max(0, percentage));
    return (
        <div
            className={`h-2 w-full bg-dark-border rounded overflow-hidden ${className}`}
            role="progressbar"
            aria-label={label}
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-full transition-[width] duration-150 ${fillClassName}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};
