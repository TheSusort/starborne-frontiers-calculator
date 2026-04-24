import React, { useState } from 'react';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button, Input, Modal } from '../ui';

interface Props {
    altId: string;
    currentUsername: string;
    onClose: () => void;
}

export const RenameAltModal: React.FC<Props> = ({ altId, currentUsername, onClose }) => {
    const { renameAlt } = useActiveProfile();
    const { addNotification } = useNotification();
    const [username, setUsername] = useState(currentUsername);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        setError('');
        setSubmitting(true);
        try {
            await renameAlt(altId, username.trim());
            addNotification('success', 'Alt renamed.');
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            setError(msg.includes('users_username_key') ? 'Username taken' : msg);
        } finally {
            setSubmitting(false);
        }
    };

    const disabled = username.trim() === '' || submitting;

    return (
        <Modal isOpen title="Rename alt account" onClose={onClose}>
            <div className="space-y-4">
                <Input
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    error={error}
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={disabled}>
                        Rename
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
