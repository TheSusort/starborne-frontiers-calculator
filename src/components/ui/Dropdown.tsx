import React, { useState, useRef, useEffect } from 'react';

interface DropdownProps {
    trigger: React.ReactNode;
    children: React.ReactNode;
    align?: 'left' | 'right';
}

interface DropdownItemProps {
    onClick: (e: React.MouseEvent) => void;
    children: React.ReactNode;
    className?: string;
}

const DropdownItem: React.FC<DropdownItemProps> = ({ onClick, children, className = '' }) => (
    <button
        className={`w-full text-left px-4 py-2 hover:bg-dark-lighter ${className}`}
        onClick={onClick}
    >
        {children}
    </button>
);

export const Dropdown: React.FC<DropdownProps> & { Item: typeof DropdownItem } = ({
    trigger,
    children,
    align = 'right',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                {trigger}
            </div>
            {isOpen && (
                <div
                    className={`absolute z-50 mt-2 ${
                        align === 'right' ? 'right-0' : 'left-0'
                    } min-w-[200px] bg-dark border border-dark-border shadow-lg`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {children}
                </div>
            )}
        </div>
    );
};

Dropdown.Item = DropdownItem;
