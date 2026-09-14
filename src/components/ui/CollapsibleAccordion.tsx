import React, { memo } from 'react';

interface CollapsibleAccordionProps {
    isOpen: boolean;
    children: React.ReactNode;
    /** Forwarded to the outer (animated) element — lets a toggle's `aria-controls` target it. */
    id?: string;
}

/**
 * Children stay mounted while closed so the height transition has something to animate, which
 * would otherwise leave every control inside a closed accordion in the tab order. `inert` removes
 * them from it without affecting layout, so the animation is unchanged.
 *
 * Spread as a raw attribute because React 18's JSX types do not declare `inert`; it is a boolean
 * HTML attribute, so presence alone is what disables the subtree.
 */
const inertWhenClosed = (isOpen: boolean) => (isOpen ? {} : { inert: '' }) as { inert?: string };

export const CollapsibleAccordion: React.FC<CollapsibleAccordionProps> = memo(
    ({ isOpen, children, id }) => {
        return (
            <div
                {...inertWhenClosed(isOpen)}
                id={id}
                className="transition-all duration-300 ease-in-out overflow-hidden"
                style={{
                    maxHeight: isOpen ? '2000px' : '0',
                    opacity: isOpen ? 1 : 0,
                }}
            >
                <div className="p-4 bg-dark">{children}</div>
            </div>
        );
    }
);

CollapsibleAccordion.displayName = 'CollapsibleAccordion';
