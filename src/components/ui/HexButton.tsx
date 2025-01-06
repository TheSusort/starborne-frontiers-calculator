import React from 'react';

interface HexButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isActive?: boolean;
    isSelected?: boolean;
    children: React.ReactNode;
}

export const HexButton: React.FC<HexButtonProps> = ({
    isActive,
    isSelected,
    children,
    className = '',
    ...props
}) => {
    return (
        <button
            className={`
                w-full aspect-[1.15/1] relative
                transform scale-[1.15]
                ${className}
            `}
            {...props}
        >
            <div
                className={`
                    absolute inset-0
                    clip-hex transition-colors duration-200
                    flex items-center justify-center
                    transform rotate-[30deg]
                    ${isActive ? 'bg-primary' : 'bg-dark-lighter'}
                    ${isSelected ? 'bg-yellow-500' : ''}
                    hover:bg-white
                `}
            >
                <div className="clip-hex transform scale-95 bg-dark w-full h-full">
                    <div className="transform rotate-[-30deg] w-full h-full flex items-center justify-center">
                        {children}
                    </div>
                </div>
            </div>
        </button>
    );
};
