import React from 'react';

export const CopyIcon: React.FC<{ className?: string }> = ({ className = '' }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-4 h-4 ${className}`}
        >
            <path d="m 3.75,4.25 h 14 c 1.108,0 2,0.892 2,2 v 14 c 0,1.108 -0.892,2 -2,2 h -14 c -1.108,0 -2,-0.892 -2,-2 v -14 c 0,-1.108 0.892,-2 2,-2 z m 2.5,-2.5 h 14 c 1.108,0 2,0.892 2,2 v 14" />
        </svg>
    );
};
