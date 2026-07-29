import React, { useEffect, useState } from 'react';
import { Button, Input, Modal } from '../ui';
import { Ship } from '../../types/ship';

interface SaveAutogearTeamModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The current selection, in gear-pick order. */
    ships: Ship[];
    existingNames: string[];
    /** Suggested name, e.g. the encounter a selection was imported from. */
    initialName?: string;
    onSave: (name: string) => void;
}

export const SaveAutogearTeamModal: React.FC<SaveAutogearTeamModalProps> = ({
    isOpen,
    onClose,
    ships,
    existingNames,
    initialName,
    onSave,
}) => {
    const [name, setName] = useState(initialName ?? '');
    const [error, setError] = useState<string | null>(null);

    // Re-seed when the dialog reopens with a different suggestion.
    useEffect(() => {
        if (isOpen) {
            setName(initialName ?? '');
            setError(null);
        }
    }, [isOpen, initialName]);

    const handleSave = () => {
        const trimmed = name.trim();

        if (!trimmed) {
            setError('Give the team a name');
            return;
        }

        const isDuplicate = existingNames.some(
            (existing) => existing.trim().toLowerCase() === trimmed.toLowerCase()
        );

        if (isDuplicate) {
            setError('A team with this name already exists');
            return;
        }

        setError(null);
        onSave(trimmed);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Save team" maxWidth="max-w-lg">
            <div className="space-y-4">
                <Input
                    label="Team name"
                    value={name}
                    error={error ?? undefined}
                    onChange={(event) => {
                        setName(event.target.value);
                        setError(null);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') handleSave();
                    }}
                />

                <div className="card">
                    <p className="text-sm text-theme-text-secondary mb-2">
                        Gear is assigned in this order — the first ship gets first pick.
                    </p>
                    <ol className="space-y-1">
                        {ships.map((ship, index) => (
                            <li key={ship.id} className="text-sm">
                                {index + 1}. {ship.name}
                            </li>
                        ))}
                    </ol>
                </div>

                <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSave}>
                        Save team
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
