import React, { useEffect } from 'react';
import { Button, CloseIcon } from '../';

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
        } else {
            // Restore scroll position
            const scrollY = document.body.style.top;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            window.scrollTo(0, parseInt(scrollY || '0') * -1);
        }

        return () => {
            // Cleanup
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className="fixed inset-0 z-50">
                <div
                    className={`flex min-h-full ${fullHeight ? '' : 'items-center'} justify-center p-4`}
                    onClick={onClose}
                >
                    <div
                        className="relative transform overflow-hidden bg-dark-lighter border border-gray-600 shadow-xl transition-all w-full max-w-4xl max-h-[90vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-600 flex justify-between items-center">
                            <h3 className="text-xl font-semibold text-gray-200">{title}</h3>
                            <Button aria-label="Close modal" variant="secondary" onClick={onClose}>
                                <CloseIcon />
                            </Button>
                        </div>

                        {/* Content - Now scrollable */}
                        <div className="px-6 py-4 overflow-y-auto">{children}</div>
                    </div>
                </div>
            </div>
        </>
    );
};
