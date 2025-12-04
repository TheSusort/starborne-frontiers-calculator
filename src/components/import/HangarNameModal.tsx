import React, { useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (hangarName: string) => void;
    loading?: boolean;
    fileSize?: number;
}

export const HangarNameModal: React.FC<Props> = ({
    isOpen,
    onClose,
    onSubmit,
    loading = false,
    fileSize,
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
        <Modal isOpen={isOpen} onClose={handleClose} title="Enter Hangar Name" highZIndex={true}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-gray-300">
                    Please enter a name for your hangar that will be displayed on
                    frontiers.cubedweb.net
                </p>

                {fileSize && (
                    <div className="bg-blue-900/20 border border-blue-500/30 p-3">
                        <p className="text-blue-300 text-sm">
                            <strong>File size:</strong> {(fileSize / 1024 / 1024).toFixed(1)}MB
                            {fileSize > 10 * 1024 * 1024 && (
                                <span className="block mt-1 text-yellow-300">
                                    ⚠️ Large file detected. Upload may take a few moments...
                                </span>
                            )}
                        </p>
                    </div>
                )}

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
