import React from 'react';

/** A small non-interactive label for one item in a short list — a stat name, a set name.
 *  Use it where comma-separated prose would otherwise force the reader to parse a sentence
 *  to count the items. For anything clickable use `Button`.
 *
 *  `variant="accent"` is Signal Orange, which marks the action, the active thing or the focused
 *  thing; on a chip it marks the viewer's own item (the "YOU" tag on their leaderboard place).
 *  It is not a second category colour: a group of chips that needs to say two different things
 *  needs two labelled groups, not two chip colours. */
interface ChipProps {
    children: React.ReactNode;
    variant?: 'default' | 'accent';
    className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ChipProps['variant']>, string> = {
    default: 'bg-dark-lighter border-dark-border text-theme-text',
    accent: 'bg-primary/20 border-primary/70 text-primary font-semibold tracking-wider',
};

export const Chip: React.FC<ChipProps> = ({ children, variant = 'default', className = '' }) => (
    <span
        className={`inline-flex items-center px-2 py-0.5 text-xs border whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}
    >
        {children}
    </span>
);
