import React, { useState, useRef, useEffect } from 'react';

interface DropdownProps {
    trigger: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
    children: React.ReactNode;
    align?: 'left' | 'right';
    direction?: 'down' | 'up';
}

interface DropdownItemProps {
    onClick: (e: React.MouseEvent) => void;
    children: React.ReactNode;
    className?: string;
}

interface DropdownSubmenuProps {
    label: React.ReactNode;
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

const DropdownSubmenu: React.FC<DropdownSubmenuProps> = ({ label, children, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const submenuRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

    const handleMouseEnter = () => {
        clearTimeout(timeoutRef.current);
        setIsOpen(true);
    };

    const handleMouseLeave = () => {
        timeoutRef.current = setTimeout(() => setIsOpen(false), 150);
    };

    useEffect(() => {
        return () => clearTimeout(timeoutRef.current);
    }, []);

    return (
        <div
            className="relative"
            ref={submenuRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <button
                className={`w-full text-left px-4 py-2 hover:bg-dark-lighter flex items-center justify-between ${className}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                {label}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 ml-2"
                >
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>
            {isOpen && (
                <div
                    className="absolute right-full top-0 min-w-[200px] bg-dark border border-dark-border shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                >
                    {children}
                </div>
            )}
        </div>
    );
};

export const Dropdown: React.FC<DropdownProps> & {
    Item: typeof DropdownItem;
    Submenu: typeof DropdownSubmenu;
} = ({ trigger, children, align = 'right', direction = 'down' }) => {
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
                {typeof trigger === 'function' ? trigger(isOpen) : trigger}
            </div>
            {isOpen && (
                <div
                    className={`absolute z-50 ${
                        direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
                    } ${
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
Dropdown.Submenu = DropdownSubmenu;
