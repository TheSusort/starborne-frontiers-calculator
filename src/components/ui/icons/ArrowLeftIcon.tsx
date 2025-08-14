import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const ArrowLeftIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
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
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
    </svg>
);
