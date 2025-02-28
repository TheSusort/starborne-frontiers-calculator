import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const CheckIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            viewBox="0 0 48 48"
            version="1"
            xmlns="http://www.w3.org/2000/svg"
            className={`w-4 h-4 ${className}`}
            role="img"
            aria-hidden="true"
            {...props}
        >
            <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
            <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
            <g id="SVGRepo_iconCarrier">
                {' '}
                <polygon
                    fill="currentColor"
                    points="40.6,12.1 17,35.7 7.4,26.1 4.6,29 17,41.3 43.4,14.9"
                ></polygon>{' '}
            </g>
        </svg>
    );
};
