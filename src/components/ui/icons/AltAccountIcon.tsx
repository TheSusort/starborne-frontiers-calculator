import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

/**
 * Two overlapping user silhouettes — represents an alt/secondary account.
 * Parent element controls color via Tailwind text-* classes (currentColor).
 */
export const AltAccountIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
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
        {/* Back user (offset slightly right) */}
        <path d="M17 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        {/* Front user */}
        <path d="M13 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
    </svg>
);
