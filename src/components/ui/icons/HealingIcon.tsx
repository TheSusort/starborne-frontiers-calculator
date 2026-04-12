import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const HealingIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
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
        <path d="M11 2a2 2 0 0 1 2 0l6.5 3.75a2 2 0 0 1 1 1.73v7.04a2 2 0 0 1-1 1.73L13 20a2 2 0 0 1-2 0l-6.5-3.75a2 2 0 0 1-1-1.73V7.48a2 2 0 0 1 1-1.73z" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
    </svg>
);
