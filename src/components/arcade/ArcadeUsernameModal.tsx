import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import {
    checkUsernameAvailability,
    isValidUsername,
    updateUserProfile,
} from '../../services/userProfileService';

interface Props {
    isOpen: boolean;
    userId: string;
    onSaved: () => void;
    onCancel: () => void;
}

export const ArcadeUsernameModal: React.FC<Props> = ({ isOpen, userId, onSaved, onCancel }) => {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setValue('');
        setError(null);
    }, [isOpen]);

    const save = async () => {
        if (saving) return;
        const name = value.trim();
        if (!isValidUsername(name)) {
            setError('3-20 characters: letters, numbers, spaces, dashes and underscores');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if (!(await checkUsernameAvailability(name))) {
                setError('Username is already taken');
                return;
            }
            await updateUserProfile(userId, { username: name });
            onSaved();
        } catch (e) {
            if ((e as { code?: string } | null)?.code === '23505') {
                setError('Username is already taken');
                return;
            }
            console.error('Error saving arcade username:', e);
            setError('Could not save the username, please try again');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title="Choose a leaderboard name"
            maxWidth="max-w-md"
        >
            <div className="space-y-4">
                <p className="text-theme-text">
                    Your name is shown next to your score on the arcade leaderboard. You can change
                    it later on your profile.
                </p>
                <Input
                    label="Username"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save();
                    }}
                    error={error ?? undefined}
                    maxLength={20}
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onCancel}>
                        Skip
                    </Button>
                    <Button onClick={() => void save()} disabled={saving}>
                        Save
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
