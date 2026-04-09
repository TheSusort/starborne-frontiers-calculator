import React, { useState, useRef, useEffect } from 'react';
import { ChevronUpIcon, ChevronDownIcon } from './icons';
import { InfoIcon } from './icons/InfoIcon';
import { Tooltip } from './layout/Tooltip';

interface Props {
    label?: string;
    error?: string;
    options: { value: string; label: string; group?: string }[];
    className?: string;
    noDefaultSelection?: boolean;
    defaultOption?: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    id?: string;
    'data-testid'?: string;
    helpLabel?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
}

export const Select: React.FC<Props> = ({
    label,
    error,
    options,
    className = '',
    noDefaultSelection = false,
    defaultOption = 'Select',
    value,
    onChange,
    disabled = false,
    id,
    'data-testid': testId,
    helpLabel,
    searchable = false,
    searchPlaceholder = 'Search...',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const selectId = id || `select-${Math.random().toString(36).substring(2, 15)}`;
    const [showHelpTooltip, setShowHelpTooltip] = useState(false);
    const infoIconRef = useRef<HTMLDivElement>(null);

    const tooltip = (
        <Tooltip
            isVisible={showHelpTooltip}
            className="bg-dark border border-dark-lighter p-2 w-[80%] max-w-[400px]"
            targetElement={infoIconRef.current}
        >
            <p>{helpLabel}</p>
        </Tooltip>
    );

    const selectedOption =
        value === '' && noDefaultSelection
            ? defaultOption
            : options.find((opt) => opt.value === value)?.label || defaultOption;

    const filteredOptions =
        searchable && searchQuery
            ? options.filter((opt) => opt.label.toLowerCase().includes(searchQuery.toLowerCase()))
            : options;

    useEffect(() => {
        if (isOpen && searchable) {
            // Small delay to ensure the dropdown is rendered
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
        if (!isOpen) {
            setSearchQuery('');
        }
    }, [isOpen, searchable]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (disabled) return;

        switch (event.key) {
            case ' ':
            case 'Enter':
                event.preventDefault();
                setIsOpen(!isOpen);
                break;
            case 'Escape':
                setIsOpen(false);
                break;
            case 'ArrowDown':
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    const currentIndex = options.findIndex((opt) => opt.value === value);
                    const nextIndex = (currentIndex + 1) % options.length;
                    onChange(options[nextIndex].value);
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    const currentIndex = options.findIndex((opt) => opt.value === value);
                    const prevIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
                    onChange(options[prevIndex].value);
                }
                break;
        }
    };

    return (
        <div className="space-y-1 grow" ref={containerRef}>
            {label && (
                <label
                    htmlFor={selectId}
                    aria-label={label}
                    className="flex text-sm font-medium items-center gap-2 justify-between"
                >
                    {label}
                    {helpLabel && (
                        <>
                            <div
                                ref={infoIconRef}
                                onMouseEnter={() => setShowHelpTooltip(true)}
                                onMouseLeave={() => setShowHelpTooltip(false)}
                            >
                                <InfoIcon className="text-sm text-theme-text-secondary h-8 w-8 p-2" />
                            </div>
                            {tooltip}
                        </>
                    )}
                </label>
            )}
            <div className="relative">
                <button
                    type="button"
                    id={selectId}
                    onClick={() => setIsOpen(!isOpen)}
                    onKeyDown={handleKeyDown}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-labelledby={label ? selectId : undefined}
                    data-testid={testId}
                    className={`
                        w-full px-4 py-2 text-left
                        bg-dark-lighter border border-dark-border
                        focus:outline-none focus:ring-2 focus:ring-primary
                        h-10 hover:bg-dark-border
                        flex items-center justify-between
                        transition-colors duration-150
                        ${error ? 'border-red-500' : 'focus:border-primary'}
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        ${className}
                    `}
                >
                    <span className="whitespace-nowrap overflow-hidden overflow-ellipsis">
                        {selectedOption}
                    </span>
                    <span className="transition-transform duration-200">
                        {isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    </span>
                </button>

                <div
                    className={`
                        absolute z-10 min-w-full w-auto
                        bg-dark-lighter border border-dark-border
                        shadow-lg
                        max-h-60 overflow-y-auto overflow-x-hidden
                        transition-all duration-200 origin-top
                        ${
                            isOpen
                                ? 'opacity-100 scale-100 translate-y-1'
                                : 'opacity-0 scale-95 translate-y-0 pointer-events-none'
                        }
                    `}
                    role="listbox"
                >
                    {searchable && isOpen && (
                        <div className="sticky top-0 bg-dark-lighter border-b border-dark-border p-2">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setIsOpen(false);
                                    }
                                    e.stopPropagation();
                                }}
                                placeholder={searchPlaceholder}
                                className="w-full px-3 py-1.5 text-sm bg-dark border border-dark-border focus:outline-none focus:ring-1 focus:ring-primary text-theme-text"
                            />
                        </div>
                    )}
                    {noDefaultSelection && (
                        <div
                            role="option"
                            aria-selected={value === ''}
                            onClick={() => {
                                onChange('');
                                setIsOpen(false);
                            }}
                            className={`
                                px-4 py-2 cursor-pointer
                                transition-colors duration-150
                                ${
                                    value === ''
                                        ? 'bg-primary text-dark'
                                        : ' hover:bg-primary hover:text-dark'
                                }
                            `}
                        >
                            {defaultOption}
                        </div>
                    )}
                    {filteredOptions.map((option, index) => {
                        const prevGroup = index > 0 ? filteredOptions[index - 1].group : undefined;
                        const showGroupHeader = option.group && option.group !== prevGroup;
                        return (
                            <React.Fragment key={option.value}>
                                {showGroupHeader && (
                                    <div className="px-4 py-1 text-xs font-semibold text-theme-text-secondary uppercase tracking-wider bg-dark border-t border-dark-border">
                                        {option.group}
                                    </div>
                                )}
                                <div
                                    role="option"
                                    aria-selected={option.value === value}
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={`
                                        px-4 py-2 cursor-pointer
                                        transition-colors duration-150
                                        ${
                                            option.value === value
                                                ? 'bg-primary text-dark'
                                                : ' hover:bg-primary hover:text-dark'
                                        }
                                    `}
                                >
                                    {option.label}
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
};
