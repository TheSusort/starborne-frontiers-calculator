import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & { className?: string };

export const PlayIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
    <svg
        className={`w-4 h-4 ${className}`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        {...props}
    >
        <path d="M8 5v14l11-7z" />
    </svg>
);

export const PauseIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
    <svg
        className={`w-4 h-4 ${className}`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        {...props}
    >
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);

export const StopIcon: React.FC<IconProps> = ({ className = '', ...props }) => (
    <svg
        className={`w-4 h-4 ${className}`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        {...props}
    >
        <rect x="6" y="6" width="12" height="12" />
    </svg>
);
