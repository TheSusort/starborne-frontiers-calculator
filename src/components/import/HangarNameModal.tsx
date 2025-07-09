import React, { useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (hangarName: string) => void;
    loading?: boolean;
}

export const HangarNameModal: React.FC<Props> = ({
    isOpen,
    onClose,
    onSubmit,
    loading = false,
}) => {
    const [hangarName, setHangarName] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!hangarName.trim()) {
            setError('Hangar name is required');
            return;
        }

        if (hangarName.trim().length < 3) {
            setError('Hangar name must be at least 3 characters long');
            return;
        }

        setError('');
        onSubmit(hangarName.trim());
    };

    const handleClose = () => {
        setHangarName('');
        setError('');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Enter Hangar Name">
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-gray-300">
                    Please enter a name for your hangar that will be displayed on
                    frontiers.cubedweb.net
                </p>

                <Input
                    label="Hangar Name"
                    value={hangarName}
                    onChange={(e) => setHangarName(e.target.value)}
                    placeholder="Enter hangar name..."
                    error={error}
                    disabled={loading}
                    autoFocus
                />

                <div className="flex justify-end gap-2 pt-4">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleClose}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={loading || !hangarName.trim()}
                    >
                        {loading ? 'Uploading...' : 'Upload to Cubedweb'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};
