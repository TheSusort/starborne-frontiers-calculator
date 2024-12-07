import React from 'react';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'link';
    fullWidth?: boolean;
}

export const Button: React.FC<Props> = ({
    children,
    variant = 'primary',
    fullWidth = false,
    className = '',
    ...props
}) => {
    const baseStyles = "px-4 py-2 transition-colors font-medium h-10";
    const variants = {
        primary: "text-dark bg-gradient-to-r from-primary to-primary-hover hover:bg-gradient-to-r hover:from-primary-hover hover:to-primary",
        secondary: "bg-dark border border-dark-lighter text-gray-200 hover:bg-dark-border",
        danger: "bg-gradient-to-r from-red-600 to-red-500 text-gray-200 hover:bg-gradient-to-r hover:from-red-500 hover:to-red-500",
        link: "text-gray-200 hover:text-gray-200 !p-0 bg-dark min-h-10"
    };

    return (
        <button
            className={`
                ${baseStyles}
                ${variants[variant]}
                ${fullWidth ? 'w-full' : ''}
                ${className}
            `}
            {...props}
        >
            {children}
        </button>
    );
};