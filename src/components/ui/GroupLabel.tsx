import React from 'react';

/** The small-caps label above a short list of related items — a row of stat chips, a slot group,
 *  a set of board controls. It names the group without competing with the heading above it.
 *
 *  Not a heading: it labels a list, so it carries no h-level and stays in the system sans that
 *  every other piece of read text uses. */
export const GroupLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({
    children,
    className = '',
}) => (
    <p className={`text-xs uppercase tracking-wide text-theme-text-secondary ${className}`}>
        {children}
    </p>
);
