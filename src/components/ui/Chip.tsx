import React from 'react';

/** A small non-interactive label for one item in a short list — a stat name, a set name.
 *  Use it where comma-separated prose would otherwise force the reader to parse a sentence
 *  to count the items. For anything clickable use `Button`.
 *
 *  There is deliberately one chip, with no accent variant: a chip labels an item, and Signal
 *  Orange marks the action, the active thing or the focused thing. A group of chips that needs
 *  to say two different things needs two labelled groups, not two chip colours. */
interface ChipProps {
    children: React.ReactNode;
    className?: string;
}

export const Chip: React.FC<ChipProps> = ({ children, className = '' }) => (
    <span
        className={`inline-flex items-center px-2 py-0.5 text-xs border whitespace-nowrap bg-dark-lighter border-dark-border text-theme-text ${className}`}
    >
        {children}
    </span>
);
