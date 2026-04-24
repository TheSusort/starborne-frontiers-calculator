import React, { useState } from 'react';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button, Input, Modal } from '../ui';

interface Props {
    onClose: () => void;
}

export const CreateAltModal: React.FC<Props> = ({ onClose }) => {
    const { createAlt } = useActiveProfile();
    const { addNotification } = useNotification();
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        setError('');
        setSubmitting(true);
        try {
            await createAlt(username.trim());
            addNotification('success', 'Alt created. Switch to it to import game data.');
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
        <Modal isOpen title="Create alt account" onClose={onClose}>
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
                        Create
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
