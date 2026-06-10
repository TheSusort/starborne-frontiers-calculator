import React, { useId, useRef, useState } from 'react';
import { Checkbox } from './Checkbox';
import { Tooltip } from './layout/Tooltip';
import { InfoIcon } from './icons/InfoIcon';

interface Props {
    label: string;
    values: string[];
    onChange: (values: string[]) => void;
    options: { value: string; label: string }[];
    className?: string;
    disabled?: boolean;
    helpLabel?: string;
}

export const CheckboxGroup: React.FC<Props> = ({
    label,
    values,
    onChange,
    options,
    className = '',
    disabled = false,
    helpLabel,
}) => {
    const uid = useId();
    const [showHelpTooltip, setShowHelpTooltip] = useState(false);
    const infoIconRef = useRef<HTMLDivElement>(null);

    const handleChange = (value: string) => {
        const newValues = values.includes(value)
            ? values.filter((v) => v !== value)
            : [...values, value];
        onChange(newValues);
    };

    return (
        <div className={className}>
            <label className="flex text-sm font-medium items-center gap-2 justify-between mb-2">
                {label}
                {helpLabel && (
                    <>
                        <div
                            ref={infoIconRef}
                            onMouseEnter={() => setShowHelpTooltip(true)}
                            onMouseLeave={() => setShowHelpTooltip(false)}
                        >
                            <InfoIcon className="text-sm text-theme-text-secondary h-5 w-5 p-0.5" />
                        </div>
                        <Tooltip
                            isVisible={showHelpTooltip}
                            className="bg-dark border border-dark-lighter p-2 w-[80%] max-w-[400px]"
                            targetElement={infoIconRef.current}
                        >
                            <p>{helpLabel}</p>
                        </Tooltip>
                    </>
                )}
            </label>
            <div className="space-y-2">
                {options.map((option) => (
                    <Checkbox
                        key={option.value}
                        id={`${uid}-${option.value}`}
                        label={option.label}
                        checked={values.includes(option.value)}
                        onChange={() => handleChange(option.value)}
                        disabled={disabled}
                    />
                ))}
            </div>
        </div>
    );
};
