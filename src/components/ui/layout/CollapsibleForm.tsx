import React from 'react';

interface CollapsibleFormProps {
    isVisible: boolean;
    children: React.ReactNode;
    className?: string;
}

export const CollapsibleForm: React.FC<CollapsibleFormProps> = ({
    isVisible,
    children,
    className,
}) => {
    return (
        <div
            // A closed form stays mounted; `inert` keeps its fields and submit button out of
            // tab order and clicks. React 18 only passes `inert` through as a string attribute.
            {...(!isVisible && { inert: '' })}
            className={`
                transition-all duration-300 ease-in-out
                ${isVisible ? 'max-h-[3300px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden !m-0'}
                ${className || ''}
            `}
        >
            {children}
        </div>
    );
};
