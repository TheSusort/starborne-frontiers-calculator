import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const TargetIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        className={`w-4 h-4 ${className}`}
        {...props}
    >
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
        <circle cx="12" cy="12" r="6" strokeWidth={2} />
        <circle cx="12" cy="12" r="2" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
);
