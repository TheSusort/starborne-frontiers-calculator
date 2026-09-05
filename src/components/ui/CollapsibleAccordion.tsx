import React, { memo } from 'react';

interface CollapsibleAccordionProps {
    isOpen: boolean;
    children: React.ReactNode;
    /** Forwarded to the outer (animated) element — lets a toggle's `aria-controls` target it. */
    id?: string;
}

export const CollapsibleAccordion: React.FC<CollapsibleAccordionProps> = memo(
    ({ isOpen, children, id }) => {
        return (
            <div
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
