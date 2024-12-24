import React from 'react';

interface CollapsibleFormProps {
    isVisible: boolean;
    children: React.ReactNode;
}

export const CollapsibleForm: React.FC<CollapsibleFormProps> = ({
    isVisible,
    children
}) => {
    return (
        <div
            className={`
                transition-all duration-300 ease-in-out
                ${isVisible ? 'max-h-[3300px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden !m-0'}
            `}
        >
            {children}
        </div>
    );
};