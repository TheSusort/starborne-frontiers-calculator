import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { isValidGuestName } from '../../utils/arcade/leaderboardRows';

interface Props {
    isOpen: boolean;
    onSave: (name: string) => Promise<'saved' | 'taken'>;
    onCancel: () => void;
}

/** Guest names are their own namespace: unique among guests, shown with a GUEST tag. */
export const GuestNameModal: React.FC<Props> = ({ isOpen, onSave, onCancel }) => {
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
        if (!isValidGuestName(name)) {
            setError('3-20 characters: letters, numbers, spaces, dashes and underscores');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if ((await onSave(name)) === 'taken') setError('Another guest already uses that name');
        } catch (e) {
            console.error('Error joining the arcade leaderboard as a guest:', e);
            setError('Could not save your score, please try again');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onCancel} title="Join as a guest" maxWidth="max-w-md">
            <div className="space-y-4">
                <p className="text-theme-text">
                    Pick a name for the leaderboard. Guest scores show a GUEST tag and stay on this
                    device. Sign in instead to use your account name.
                </p>
                <Input
                    label="Guest name"
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
                        Join
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
