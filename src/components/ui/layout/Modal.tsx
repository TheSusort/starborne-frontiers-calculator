import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button';
import { CloseIcon } from '../icons/CloseIcon';

// Create a single portal root for all modals
const getOrCreatePortalRoot = (highZIndex = false) => {
    const rootId = highZIndex ? 'modal-root-high' : 'modal-root';
    let portalRoot = document.getElementById(rootId);
    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.setAttribute('id', rootId);
        portalRoot.className = highZIndex ? 'z-[80] relative' : 'z-[60] relative';
        document.body.appendChild(portalRoot);
    }
    return portalRoot;
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    fullHeight?: boolean;
    highZIndex?: boolean;
    maxWidth?: string;
}

export const Modal: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    fullHeight = false,
    highZIndex = false,
    maxWidth = 'max-w-4xl',
}) => {
    useEffect(() => {
        if (isOpen) {
            // Save current scroll position
            const scrollY = window.scrollY;

            // Apply multiple properties to ensure scroll lock
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';

            // Add escape key handler
            const handleEscape = (e: KeyboardEvent) => {
                if (e.key === 'Escape') onClose();
            };
            document.addEventListener('keydown', handleEscape);

            return () => {
                // Cleanup
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.width = '';
                document.body.style.overflow = '';
                document.removeEventListener('keydown', handleEscape);
            };
        }
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const portalRoot = getOrCreatePortalRoot(highZIndex);

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className={`fixed inset-0 ${highZIndex ? 'z-[70]' : 'z-50'}`}>
                <div
                    className={`flex h-full max-h-[calc(100vh-2rem)] ${fullHeight ? '' : 'items-center'} justify-center p-4`}
                    onClick={onClose}
                >
                    <div
                        className={`relative transform overflow-hidden bg-dark-lighter border border-dark-border shadow-xl transition-all w-full ${maxWidth} flex flex-col`}
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-labelledby="modal-title"
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-dark-border flex justify-between items-center">
                            <div>
                                <h3 id="modal-title" className="text-xl font-semibold">
                                    {title}
                                </h3>
                                {subtitle && (
                                    <p className="text-xs text-theme-text-secondary mt-0.5">
                                        {subtitle}
                                    </p>
                                )}
                            </div>
                            <Button aria-label="Close modal" variant="secondary" onClick={onClose}>
                                <CloseIcon />
                            </Button>
                        </div>

                        {/* Content - Now scrollable */}
                        <div className="px-6 py-4 overflow-y-auto flex-1 max-h-[80vh]">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </>,
        portalRoot
    );
};
