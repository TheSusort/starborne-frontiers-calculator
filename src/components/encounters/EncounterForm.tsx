import React, { useState, useEffect } from 'react';
import { Position, ShipPosition, EncounterNote } from '../../types/encounters';
import { Ship } from '../../types/ship';
import { ShipSelector } from '../ship/ShipSelector';
import FormationGrid from './FormationGrid';
import { Button, Input } from '../ui';

interface EncounterFormProps {
    onSubmit: (encounter: EncounterNote) => void;
    initialEncounter?: EncounterNote | null;
    onCancel?: () => void;
}

const EncounterForm: React.FC<EncounterFormProps> = ({ onSubmit, initialEncounter, onCancel }) => {
    const [name, setName] = useState('');
    const [formation, setFormation] = useState<ShipPosition[]>([]);
    const [selectedPosition, setSelectedPosition] = useState<Position>();

    useEffect(() => {
        if (initialEncounter) {
            setName(initialEncounter.name);
            setFormation(initialEncounter.formation);
        } else {
            setName('');
            setFormation([]);
        }
    }, [initialEncounter]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const encounterData: EncounterNote = {
            id: initialEncounter?.id || Date.now().toString(),
            name,
            formation,
            createdAt: initialEncounter?.createdAt || Date.now(),
        };
        onSubmit(encounterData);
        setName('');
        setFormation([]);
        setSelectedPosition(undefined);
    };

    const handleShipSelect = (ship: Ship) => {
        if (!selectedPosition) return;

        setFormation((prev) => {
            const filtered = prev.filter((s) => s.position !== selectedPosition);
            return [...filtered, { shipId: ship.id, position: selectedPosition }];
        });
        setSelectedPosition(undefined);
    };

    const handleRemoveShip = (position: Position) => {
        setFormation((prev) => prev.filter((s) => s.position !== position));
        setSelectedPosition(undefined);
    };

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="bg-dark-light space-y-4">
                <div className="flex items-end space-x-2 w-full">
                    <Input
                        label="Encounter Name"
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                    <Button type="submit" variant="primary">
                        {initialEncounter ? 'Update' : 'Save'} Encounter
                    </Button>
                </div>
            </form>

            <div className="bg-dark-light space-y-4 max-w-[700px] mx-auto py-6">
                <FormationGrid
                    formation={formation}
                    onPositionSelect={setSelectedPosition}
                    selectedPosition={selectedPosition}
                    onRemoveShip={handleRemoveShip}
                />

                {selectedPosition && (
                    <div className="mt-4">
                        <h3 className="text-white text-sm mb-2">
                            Select ship for position {selectedPosition}:
                        </h3>
                        <ShipSelector
                            selected={null}
                            onSelect={handleShipSelect}
                            variant="compact"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default EncounterForm;