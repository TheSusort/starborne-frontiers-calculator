import React from 'react';
import { CheckIcon } from './icons/CheckIcon';

interface CheckboxProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    disabled?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
    label,
    checked,
    onChange,
    className = '',
    disabled = false
}) => {
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!disabled) {
                onChange(!checked);
            }
        }
    };

    return (
        <label
            className={`
                flex items-center space-x-2
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                ${className}
            `}
            onClick={() => !disabled && onChange(!checked)}
        >
            <div
                role="checkbox"
                aria-checked={checked}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={handleKeyDown}
                className={`
                    w-4 h-4
                    flex items-center justify-center
                    rounded
                    border
                    transition-all duration-200
                    ${checked
                        ? 'bg-primary border-primary'
                        : 'border-gray-600 bg-dark'
                    }
                    ${!disabled && 'hover:border-primary'}
                    focus:ring-2 focus:ring-primary focus:ring-offset-0
                    focus:outline-none
                `}
            >
                <div className={`
                    transition-all duration-200
                    ${checked
                        ? 'opacity-100 scale-100'
                        : 'opacity-0 scale-75'
                    }
                `}>
                    {checked && <CheckIcon />}
                </div>
            </div>
            <span className="text-gray-200 select-none">{label}</span>
        </label>
    );
};