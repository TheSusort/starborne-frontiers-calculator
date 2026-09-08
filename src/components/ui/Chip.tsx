import React from 'react';

/** A small non-interactive label for one item in a short list — a stat name, a set name.
 *  Use it where comma-separated prose would otherwise force the reader to parse a sentence
 *  to count the items. For anything clickable use `Button`. */
interface ChipProps {
    children: React.ReactNode;
    /** Renders the chip in the page accent instead of the neutral surface. */
    accent?: boolean;
    className?: string;
}

export const Chip: React.FC<ChipProps> = ({ children, accent = false, className = '' }) => (
    <span
        className={`inline-flex items-center px-2 py-0.5 text-xs border whitespace-nowrap ${
            accent
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-dark-lighter border-dark-border text-theme-text-secondary'
        } ${className}`}
    >
        {children}
    </span>
);
