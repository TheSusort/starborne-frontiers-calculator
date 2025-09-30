import React, { memo } from 'react';

interface CollapsibleAccordionProps {
    isOpen: boolean;
    children: React.ReactNode;
}

export const CollapsibleAccordion: React.FC<CollapsibleAccordionProps> = memo(
    ({ isOpen, children }) => {
        return (
            <div
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
