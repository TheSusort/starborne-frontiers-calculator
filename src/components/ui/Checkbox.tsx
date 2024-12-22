import React from 'react';

interface CheckboxProps {
    label: string;
    checked: boolean;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
    return (
        <label className={`flex items-center space-x-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                className="
                    w-4 h-4
                    rounded
                    border-gray-600
                    bg-dark
                    text-primary
                    focus:ring-primary
                    focus:ring-2
                    focus:ring-offset-0
                    cursor-pointer
                    disabled:cursor-not-allowed
                "
            />
            <span className="text-gray-200 select-none">{label}</span>
        </label>
    );
};