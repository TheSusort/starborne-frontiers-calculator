import React from 'react';
import { Button } from '../ui';
import { CloseIcon } from '../ui/CloseIcon';
interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export const Modal: React.FC<Props> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                onClick={onClose}
            />
            <div className="fixed inset-0 z-50 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4">
                    <div
                        className="relative transform overflow-hidden bg-dark-lighter border border-gray-600 shadow-xl transition-all w-full max-w-4xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-600 flex justify-between items-center">
                            <h3 className="text-xl font-semibold text-gray-200">
                                {title}
                            </h3>
                            <Button
                                variant="secondary"
                                onClick={onClose}
                            >
                                <CloseIcon />
                            </Button>
                        </div>

                        {/* Content */}
                        <div className="px-6 py-4">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};