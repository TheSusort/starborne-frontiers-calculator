import React from 'react';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger';
    fullWidth?: boolean;
}

export const Button: React.FC<Props> = ({ 
    children, 
    variant = 'primary', 
    fullWidth = false,
    className = '',
    ...props 
}) => {
    const baseStyles = "px-4 py-2 transition-colors font-medium";
    const variants = {
        primary: "bg-primary hover:bg-primary-hover",
        secondary: "bg-dark-lighter text-gray-200 hover:bg-dark-border",
        danger: "bg-red-600 text-white hover:bg-red-500"
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