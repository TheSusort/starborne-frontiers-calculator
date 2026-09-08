import React from 'react';
import { LucideIcon } from 'lucide-react';

/** A card with a glyph in its gutter and one short statement beside it. Use it for a grid of
 *  facts or destinations, where each item is a sentence rather than a block of grouped data —
 *  a row of stat pairs belongs in a `card` of its own, not in one of these. */
export const IconPlate: React.FC<{
    icon: LucideIcon;
    children: React.ReactNode;
    className?: string;
}> = ({ icon: Icon, children, className = '' }) => (
    <div className={`card flex gap-3 ${className}`}>
        <Icon className="text-primary shrink-0 mt-0.5" size={18} aria-hidden="true" />
        <p className="text-sm text-theme-text-secondary">{children}</p>
    </div>
);
