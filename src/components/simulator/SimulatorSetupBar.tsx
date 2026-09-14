import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ConfirmModal } from '../ui/layout/ConfirmModal';
import { SETUP_NAME_MAX_LENGTH, type SimulatorSetup } from '../../utils/simulator/simulatorSetup';

interface Props {
    saved: SimulatorSetup[];
    /** Name is already trimmed and non-empty. Overwrites an existing entry of the same name. */
    onSave: (name: string) => void;
    onLoad: (name: string) => void;
    onDelete: (name: string) => void;
    /** False when there is nothing worth saving (both boards empty). */
    canSave: boolean;
    /** False while the ship data a setup resolves against is still arriving. Loading then would
     *  drop every cell the data has not reached yet and replace the live boards with the
     *  remainder. */
    canLoad?: boolean;
}

/** Save the current boards under a name, and load or delete a previously saved setup. */
const SimulatorSetupBar: React.FC<Props> = ({
    saved,
    onSave,
    onLoad,
    onDelete,
    canSave,
    canLoad = true,
}) => {
    const [name, setName] = useState('');
    const [selected, setSelected] = useState('');
    const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    const handleSave = () => {
        const trimmed = name.trim();
        // A name past the stored limit is refused rather than truncated: the schema rejects it on
        // read, so saving one would appear to work and be gone after a reload.
        if (!trimmed || !canSave || trimmed.length > SETUP_NAME_MAX_LENGTH) return;
        if (saved.some((setup) => setup.name === trimmed)) {
            setPendingOverwrite(trimmed);
            return;
        }
        onSave(trimmed);
        setName('');
    };

    return (
        <div className="card space-y-3">
            <h2 className="text-lg font-semibold">Setups</h2>
            <div className="flex flex-wrap items-end gap-2">
                <Input
                    label="Setup name"
                    value={name}
                    placeholder="Wave 3 attempt"
                    maxLength={SETUP_NAME_MAX_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                />
                <Button variant="primary" disabled={!canSave} onClick={handleSave}>
                    Save
                </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <Select
                    label="Saved setups"
                    noDefaultSelection
                    defaultOption={saved.length > 0 ? 'Select a setup' : 'No saved setups'}
                    value={selected}
                    options={saved.map((setup) => ({ value: setup.name, label: setup.name }))}
                    onChange={setSelected}
                />
                <Button
                    variant="secondary"
                    disabled={!selected || !canLoad}
                    onClick={() => onLoad(selected)}
                >
                    Load
                </Button>
                <Button
                    variant="secondary"
                    disabled={!selected}
                    onClick={() => setPendingDelete(selected)}
                >
                    Delete
                </Button>
            </div>
            <ConfirmModal
                isOpen={pendingOverwrite !== null}
                onClose={() => setPendingOverwrite(null)}
                onConfirm={() => {
                    if (!pendingOverwrite) return;
                    onSave(pendingOverwrite);
                    setName('');
                }}
                title="Overwrite setup"
                message={`Overwrite ${pendingOverwrite}?`}
            />
            <ConfirmModal
                isOpen={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (!pendingDelete) return;
                    onDelete(pendingDelete);
                    if (selected === pendingDelete) setSelected('');
                }}
                title="Delete setup"
                message={`Delete ${pendingDelete}? This cannot be undone.`}
            />
        </div>
    );
};

export default SimulatorSetupBar;
