import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const FilterIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
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
            role="img"
            aria-hidden="true"
            {...props}
        >
            <path d="M21 6H3" />
            <path d="M10 12H21" />
            <path d="M15 18H21" />
        </svg>
    );
};
