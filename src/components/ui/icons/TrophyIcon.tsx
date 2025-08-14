import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const TrophyIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
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
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M6 19h12" />
        <path d="M6 4h12" />
        <path d="M8 4v8c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2V6" />
        <path d="M10 14.66V17c0 1.1.9 2 2 2s2-.9 2-2v-2.34" />
    </svg>
);
