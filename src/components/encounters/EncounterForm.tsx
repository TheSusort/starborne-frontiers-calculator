import React, { useState, useEffect } from 'react';
import { Position, ShipPosition, EncounterNote, SharedShipPosition } from '../../types/encounters';
import { Ship } from '../../types/ship';
import { ShipSelector } from '../ship/ShipSelector';
import FormationGrid from './FormationGrid';
import { Button, Input, Textarea } from '../ui';
interface EncounterFormProps {
    onSubmit: (encounter: EncounterNote) => void;
    initialEncounter?: EncounterNote | null;
}

const convertToShipPosition = (position: ShipPosition | SharedShipPosition): ShipPosition => {
    if ('shipId' in position) {
        return position;
    }
    return {
        position: position.position,
        shipId: position.shipName, // This is a temporary conversion, you might want to handle this differently
    };
};

const EncounterForm: React.FC<EncounterFormProps> = ({ onSubmit, initialEncounter }) => {
    const [name, setName] = useState('');
    const [formation, setFormation] = useState<ShipPosition[]>([]);
    const [selectedPosition, setSelectedPosition] = useState<Position>();
    const [description, setDescription] = useState('');
    const [isPublic, setIsPublic] = useState(false);

    useEffect(() => {
        if (initialEncounter) {
            setName(initialEncounter.name);
            setFormation(initialEncounter.formation.map(convertToShipPosition));
            setDescription(initialEncounter.description || '');
            setIsPublic(initialEncounter.isPublic || false);
        } else {
            setName('');
            setFormation([]);
            setDescription('');
            setIsPublic(false);
        }
    }, [initialEncounter]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const encounterData = {
            id: initialEncounter?.id,
            name,
            formation,
            createdAt: initialEncounter?.createdAt || Date.now(),
            description,
            isPublic,
        };
        await onSubmit(encounterData as EncounterNote);
        setName('');
        setFormation([]);
        setDescription('');
        setSelectedPosition(undefined);
        setIsPublic(false);
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
                <Textarea
                    label="Description"
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />
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
                            sortDirection="desc"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default EncounterForm;
