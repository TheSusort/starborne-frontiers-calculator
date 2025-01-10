import React from 'react';
import { Modal } from './Modal';
import { Button } from '../';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
}) => {
    const handleConfirm = () => {
        onConfirm();
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="space-y-4">
                {typeof message === 'string' ? <p>{message}</p> : message}
                <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={onClose}>
                        {cancelLabel}
                    </Button>
                    <Button variant="danger" onClick={handleConfirm}>
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
