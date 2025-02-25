import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, CloseIcon } from '../';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    position?: 'left' | 'right';
    width?: string;
    hideCloseButton?: boolean;
    className?: string;
}

export const Offcanvas: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    children,
    position = 'right',
    width = 'w-80',
    hideCloseButton = false,
    className,
}) => {
    const [isAnimating, setIsAnimating] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Save current scroll position
            const scrollY = window.scrollY;

            // Apply multiple properties to ensure scroll lock
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';

            setShouldRender(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsAnimating(true);
                });
            });
        } else {
            // Restore scroll position
            const scrollY = document.body.style.top;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            window.scrollTo(0, parseInt(scrollY || '0') * -1);

            setIsAnimating(false);
            const timer = setTimeout(() => setShouldRender(false), 300);
            return () => clearTimeout(timer);
        }

        return () => {
            // Cleanup
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!shouldRender) return null;

    const translateClass =
        position === 'left'
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
                data-testid="offcanvas-backdrop"
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={onClose}
            />

            {/* Panel */}
            <div
                data-testid="offcanvas-panel"
                className={`
                    fixed ${position}-0 top-0 h-full ${width}
                    bg-dark p-6 shadow-lg
                    transform transition-transform duration-300 ease-in-out overflow-y-auto
                    ${translateClass}
                    ${className}
                `}
                onClick={(e) => e.stopPropagation()}
            >
                {(title || !hideCloseButton) && (
                    <div className="flex justify-between items-center mb-6">
                        {title && <h3 className="text-xl font-semibold ">{title}</h3>}
                        {!hideCloseButton && (
                            <Button
                                aria-label="Close offcanvas"
                                variant="secondary"
                                onClick={onClose}
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>
                )}
                <div
                    className={`
                    transition-opacity duration-200 ease-in-out delay-150 h-[calc(100vh-3rem)]
                    ${isAnimating ? 'opacity-100' : 'opacity-0'}
                `}
                >
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};
