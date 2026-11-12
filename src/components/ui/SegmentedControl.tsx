import React from 'react';

interface SegmentedOption {
    value: string;
    label: string;
    disabled?: boolean;
    /** Native tooltip, e.g. why the option is disabled. */
    title?: string;
}

interface SegmentedControlProps {
    /** Names the group. Shown above the options. */
    label: string;
    value: string;
    options: readonly SegmentedOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    size?: 'sm' | 'md';
    /** Read by assistive tech as the group's description and shown as its tooltip. */
    helpText?: string;
}

const SIZES = { sm: 'px-2 py-1 text-xs', md: 'px-3 py-1.5 text-sm' } as const;

/** A single-choice control: every option is visible at once and exactly one is selected. Use it
 *  for two to four short options; a longer list belongs in `Select`. */
export const SegmentedControl: React.FC<SegmentedControlProps> = ({
    label,
    value,
    options,
    onChange,
    disabled = false,
    size = 'md',
    helpText,
}) => {
    const helpId = React.useId();
    return (
        <div>
            <div className="text-sm text-theme-text-secondary mb-1">{label}</div>
            <div
                role="group"
                aria-label={label}
                aria-describedby={helpText ? helpId : undefined}
                title={helpText}
                className="inline-flex border border-dark-border"
            >
                {options.map((option) => {
                    const selected = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            disabled={disabled || option.disabled}
                            title={option.title}
                            onClick={() => {
                                if (!selected) onChange(option.value);
                            }}
                            className={`${SIZES[size]} whitespace-nowrap font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                selected
                                    ? 'bg-primary text-dark'
                                    : 'bg-dark text-theme-text hover:bg-dark-border'
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
            {helpText && (
                <span id={helpId} className="sr-only">
                    {helpText}
                </span>
            )}
        </div>
    );
};
