import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button';
import { CloseIcon } from '../ui/icons/CloseIcon';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    position?: 'left' | 'right';
    width?: string;
}

export const Offcanvas: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    children,
    position = 'right',
    width = 'w-80'
}) => {
    const [isAnimating, setIsAnimating] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            // Small delay to ensure DOM is ready before animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsAnimating(true);
                });
            });
        } else {
            setIsAnimating(false);
            const timer = setTimeout(() => setShouldRender(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!shouldRender) return null;

    const translateClass = position === 'left'
        ? `${isAnimating ? 'translate-x-0' : '-translate-x-full'}`
        : `${isAnimating ? 'translate-x-0' : 'translate-x-full'}`;

    return createPortal(
        <div
            className={`
                fixed inset-0 z-50
                transition-opacity duration-300 ease-in-out
                ${isAnimating ? 'opacity-100' : 'opacity-0'}
            `}
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            />

            {/* Panel */}
            <div
                className={`
                    fixed ${position}-0 top-0 h-full ${width}
                    bg-dark-lighter p-6 shadow-lg
                    transform transition-transform duration-300 ease-in-out
                    ${translateClass}
                `}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-semibold text-gray-200">{title}</h3>
                    <Button variant="secondary" onClick={onClose}>
                        <CloseIcon />
                    </Button>
                </div>
                <div className={`
                    transition-opacity duration-200 ease-in-out delay-150
                    ${isAnimating ? 'opacity-100' : 'opacity-0'}
                `}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};