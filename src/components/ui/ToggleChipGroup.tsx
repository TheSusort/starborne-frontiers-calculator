import React, { useId, useRef, useState } from 'react';
import { Tooltip } from './layout/Tooltip';
import { InfoIcon } from './icons/InfoIcon';

export interface ToggleChipOption {
    value: string;
    label: string;
    /** Classes for the pressed state; defaults to the primary accent. Write them as full static
     *  Tailwind class strings so the build keeps them. */
    activeClassName?: string;
    /** Classes for the small swatch shown before the label, e.g. a rarity colour. */
    swatchClassName?: string;
}

interface Props {
    label: string;
    values: string[];
    onChange: (values: string[]) => void;
    options: ToggleChipOption[];
    className?: string;
    disabled?: boolean;
    helpLabel?: string;
}

const DEFAULT_ACTIVE = 'border-primary bg-primary/20 text-primary';

/** A multi-select set of toggle chips: each chip is a button whose pressed state is the selection. */
export const ToggleChipGroup: React.FC<Props> = ({
    label,
    values,
    onChange,
    options,
    className = '',
    disabled = false,
    helpLabel,
}) => {
    const labelId = useId();
    const [showHelpTooltip, setShowHelpTooltip] = useState(false);
    const infoIconRef = useRef<HTMLDivElement>(null);

    const toggle = (value: string) =>
        onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

    return (
        <div className={className}>
            <div className="flex text-sm font-medium items-center gap-2 justify-between mb-2">
                <span id={labelId}>{label}</span>
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
            </div>
            <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
                {options.map((option) => {
                    const pressed = values.includes(option.value);
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={pressed}
                            disabled={disabled}
                            onClick={() => toggle(option.value)}
                            className={`inline-flex min-h-[2.5rem] items-center gap-2 border px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                                pressed
                                    ? (option.activeClassName ?? DEFAULT_ACTIVE)
                                    : 'border-dark-border bg-dark text-theme-text-secondary hover:border-primary/60 hover:text-theme-text'
                            }`}
                        >
                            {option.swatchClassName && (
                                <span
                                    aria-hidden="true"
                                    className={`h-2.5 w-2.5 shrink-0 ${option.swatchClassName}`}
                                />
                            )}
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
