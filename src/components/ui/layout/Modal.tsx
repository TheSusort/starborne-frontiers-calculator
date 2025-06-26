import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button, CloseIcon } from '../';

// Create a single portal root for all modals
const getOrCreatePortalRoot = () => {
    let portalRoot = document.getElementById('modal-root');
    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.setAttribute('id', 'modal-root');
        portalRoot.className = 'z-[60] relative';
        document.body.appendChild(portalRoot);
    }
    return portalRoot;
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    fullHeight?: boolean;
}

export const Modal: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    children,
    fullHeight = false,
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

    const portalRoot = getOrCreatePortalRoot();

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className="fixed inset-0 z-50">
                <div
                    className={`flex h-screen ${fullHeight ? '' : 'items-center'} justify-center p-4`}
                    onClick={onClose}
                >
                    <div
                        className="relative transform overflow-hidden bg-dark-lighter border border-gray-600 shadow-xl transition-all w-full max-w-4xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-600 flex justify-between items-center">
                            <h3 className="text-xl font-semibold ">{title}</h3>
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
