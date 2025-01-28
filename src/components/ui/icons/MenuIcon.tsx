import React from 'react';

export const MenuIcon: React.FC<{ className?: string }> = ({ className = '' }) => {
    return (
        <svg
            className={`h-4 w-4 ${className}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
            />
        </svg>
    );
};
