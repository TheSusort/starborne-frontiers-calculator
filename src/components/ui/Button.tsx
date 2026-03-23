import React from 'react';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'link';
    fullWidth?: boolean;
    size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const Button: React.FC<Props> = ({
    children,
    variant = 'primary',
    fullWidth = false,
    size = 'md',
    className = '',
    ...props
}) => {
    const baseStyles = 'transition-colors whitespace-nowrap shine-effect relative overflow-hidden';
    const variants = {
        primary:
            'text-dark clip-1-corner bg-gradient-to-br from-[rgb(var(--color-primary-gradient-from))] via-primary to-[rgb(var(--color-primary-gradient-to))]',
        secondary: 'bg-dark border border-dark-border text-theme-text hover:bg-dark-border',
        danger: 'bg-gradient-to-r from-red-600 to-red-500 text-theme-text hover:bg-gradient-to-r hover:from-red-500 hover:to-red-500',
        link: 'text-theme-text hover:text-white !p-0 bg-dark',
    };

    const sizes = {
        xs: 'px-2 py-1 text-xxs h-6',
        sm: 'px-2 py-1 text-sm h-8 font-medium',
        md: 'px-4 py-2 h-10 font-medium',
        lg: 'px-6 py-3 h-12 font-medium',
    };

    return (
        <button
            className={`
                ${baseStyles}
                ${variants[variant]}
                ${sizes[size]}
                ${fullWidth ? 'w-full' : ''}
                ${className}
            `}
            {...props}
        >
            {children}
        </button>
    );
};
