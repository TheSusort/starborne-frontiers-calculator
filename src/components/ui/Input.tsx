import React, { forwardRef, useState } from 'react';
import { Tooltip } from './layout/Tooltip';
import { InfoIcon } from './icons/InfoIcon';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    labelClassName?: string;
    helpLabel?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(
    ({ label, error, labelClassName = '', className = '', helpLabel, ...props }, ref) => {
        const id = props.id || props.name || `input-${Math.random().toString(36).substring(2, 15)}`;
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
            <div className="space-y-1 grow">
                {label && (
                    <label
                        className={`flex text-sm font-medium items-center gap-2 justify-between ${labelClassName}`}
                        htmlFor={id}
                    >
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
                    </label>
                )}
                <input
                    ref={ref}
                    className={`
                    w-full px-1 md:px-4 py-2 bg-dark-lighter border border-dark-border
                     focus:outline-none focus:ring-2 focus:ring-primary
                     placeholder-gray-500 h-10
                    ${error ? 'border-red-500' : 'focus:border-primary'}
                    ${className}
                `}
                    id={id}
                    {...props}
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
        );
    }
);

Input.displayName = 'Input';
