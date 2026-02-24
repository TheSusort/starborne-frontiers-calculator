import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const ClockIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 ${className}`}
            role="img"
            aria-hidden="true"
            {...props}
        >
            <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
                clipRule="evenodd"
            />
        </svg>
    );
};
