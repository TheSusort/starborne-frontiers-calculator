import React, { useState, useRef, useEffect } from 'react';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface Props {
    label?: string;
    error?: string;
    options: { value: string; label: string }[];
    className?: string;
    noDefaultSelection?: boolean;
    defaultOption?: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
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
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = value === '' && noDefaultSelection
        ? defaultOption
        : options.find(opt => opt.value === value)?.label || defaultOption;

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
                    const currentIndex = options.findIndex(opt => opt.value === value);
                    const nextIndex = (currentIndex + 1) % options.length;
                    onChange(options[nextIndex].value);
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                } else {
                    const currentIndex = options.findIndex(opt => opt.value === value);
                    const prevIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
                    onChange(options[prevIndex].value);
                }
                break;
        }
    };

    return (
        <div className="space-y-1 grow" ref={containerRef}>
            {label && (
                <label className="block text-sm font-medium text-gray-200">
                    {label}
                </label>
            )}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    onKeyDown={handleKeyDown}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-labelledby={label}
                    disabled={disabled}
                    className={`
                        w-full px-4 py-2
                        bg-dark-lighter border border-dark-border
                        focus:outline-none focus:ring-2 focus:ring-primary
                        text-gray-200 h-10
                        flex items-center justify-between
                        transition-colors duration-150
                        ${error ? 'border-red-500' : 'focus:border-primary'}
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        ${className}
                    `}
                >
                    <span className="whitespace-nowrap overflow-hidden overflow-ellipsis">{selectedOption}</span>
                    <span className="transition-transform duration-200">
                        {isOpen ? (
                            <ChevronUpIcon />
                        ) : (
                            <ChevronDownIcon />
                        )}
                    </span>
                </button>

                <div
                    className={`
                        absolute z-10 w-full
                        bg-dark-lighter border border-dark-border
                        rounded-md shadow-lg
                        max-h-60 overflow-auto
                        transition-all duration-200 origin-top
                        ${isOpen
                            ? 'opacity-100 scale-100 translate-y-1'
                            : 'opacity-0 scale-95 translate-y-0 pointer-events-none'
                        }
                    `}
                    role="listbox"
                >
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
                                ${value === ''
                                    ? 'bg-primary text-dark'
                                    : 'text-gray-200 hover:bg-primary hover:text-dark'
                                }
                            `}
                        >
                            {defaultOption}
                        </div>
                    )}
                    {options.map(option => (
                        <div
                            key={option.value}
                            role="option"
                            aria-selected={option.value === value}
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                            className={`
                                px-4 py-2 cursor-pointer
                                transition-colors duration-150
                                ${option.value === value
                                    ? 'bg-primary text-dark'
                                    : 'text-gray-200 hover:bg-primary hover:text-dark'
                                }
                            `}
                        >
                            {option.label}
                        </div>
                    ))}
                </div>
            </div>
            {error && (
                <p className="text-sm text-red-500">{error}</p>
            )}
        </div>
    );
};