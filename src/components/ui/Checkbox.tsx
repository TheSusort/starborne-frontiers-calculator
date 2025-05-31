import React, { useState } from 'react';
import { CheckIcon } from './icons/CheckIcon';
import { Tooltip } from './layout/Tooltip';
import { InfoIcon } from './icons/InfoIcon';

interface CheckboxProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    disabled?: boolean;
    id?: string;
    helpLabel?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
    label,
    checked,
    onChange,
    className = '',
    disabled = false,
    id: providedId,
    helpLabel,
}) => {
    const id = providedId || `checkbox-${label.toLowerCase().replace(/\s+/g, '-')}`;
    const [showHelpTooltip, setShowHelpTooltip] = useState(false);

    const tooltip = (
        <Tooltip
            isVisible={showHelpTooltip}
            className="bg-dark border border-dark-lighter p-2 w-[80%] max-w-[400px]"
        >
            <p>{helpLabel}</p>
        </Tooltip>
    );

    return (
        <div className={`flex items-center space-x-2 ${className}`}>
            <input
                type="checkbox"
                id={id}
                checked={checked}
                onChange={(e) => !disabled && onChange(e.target.checked)}
                disabled={disabled}
                className="sr-only"
            />
            <label
                htmlFor={id}
                className={`
                    flex items-center space-x-2 flex-grow
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
            >
                <div
                    role="presentation"
                    className={`
                        w-4 h-4
                        flex items-center justify-center
                        border
                        transition-all duration-200
                        ${checked ? 'bg-primary border-primary' : 'border-gray-600 bg-dark'}
                        ${!disabled && 'hover:border-primary'}
                        focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-0
                    `}
                >
                    <div
                        className={`text-dark
                        transition-all duration-200
                        ${checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
                    `}
                    >
                        {checked && <CheckIcon />}
                    </div>
                </div>
                <span className=" select-none flex items-center justify-between gap-2 w-full">
                    {label}
                    {helpLabel && (
                        <>
                            <InfoIcon
                                className="text-sm text-gray-400 h-8 w-8 p-2"
                                onMouseEnter={() => setShowHelpTooltip(true)}
                                onMouseLeave={() => setShowHelpTooltip(false)}
                            />
                            {tooltip}
                        </>
                    )}
                </span>
            </label>
        </div>
    );
};
