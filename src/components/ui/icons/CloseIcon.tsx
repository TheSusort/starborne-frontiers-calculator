import React from 'react';

export const CloseIcon: React.FC<{ className?: string }> = ({ className = '' }) => {
    return (
        <svg
            className={`w-4 h-4 ${className}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            aria-hidden="true"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
            />
        </svg>
    );
};
