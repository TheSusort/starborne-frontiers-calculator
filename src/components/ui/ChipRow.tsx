import React from 'react';
import { Chip } from './Chip';

interface ChipRowProps {
    items: readonly string[];
    /** Accessible name of the group, e.g. "Buffs". */
    label: string;
    /** The most chips shown; the rest collapse into one "+N" chip whose tooltip names them. */
    max: number;
    variant?: React.ComponentProps<typeof Chip>['variant'];
    className?: string;
}

/** One line of chips that never wraps and keeps its height when empty, so a list that changes
 *  over time does not move what is below it. Long names are truncated. */
export const ChipRow: React.FC<ChipRowProps> = ({
    items,
    label,
    max,
    variant = 'default',
    className = '',
}) => {
    const shown = items.length > max ? items.slice(0, Math.max(0, max)) : items;
    const hidden = items.slice(shown.length);
    return (
        <div
            role="list"
            aria-label={label}
            className={`flex h-5 min-w-0 flex-nowrap items-center gap-1 overflow-hidden ${className}`}
        >
            {shown.map((item) => (
                <span key={item} role="listitem" className="flex min-w-0" title={item}>
                    <Chip variant={variant} className="min-w-0 max-w-full !px-1.5">
                        <span className="truncate">{item}</span>
                    </Chip>
                </span>
            ))}
            {hidden.length > 0 && (
                <span role="listitem" className="flex shrink-0" title={hidden.join(', ')}>
                    <Chip variant={variant} className="!px-1.5">
                        +{hidden.length}
                    </Chip>
                </span>
            )}
        </div>
    );
};
