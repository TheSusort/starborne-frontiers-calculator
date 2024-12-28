import React from 'react';
import { EncounterNote } from '../../types/encounters';
import { Button, CloseIcon, EditIcon } from '../ui';
import FormationGrid from './FormationGrid';

interface EncounterListProps {
    encounters: EncounterNote[];
    onEdit: (encounter: EncounterNote) => void;
    onDelete: (encounterId: string) => void;
}

const EncounterList: React.FC<EncounterListProps> = ({ encounters, onEdit, onDelete }) => {
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white mb-4">Saved Encounters</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {encounters.map((encounter) => (
                    <div key={encounter.id} className="space-y-4 border border-dark-border">
                        <div className="flex justify-between items-start py-2 px-4 border-b border-dark-border">
                            <h3 className="text-lg font-medium text-white">{encounter.name}</h3>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onEdit(encounter)}
                                >
                                    <EditIcon />
                                </Button>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => onDelete(encounter.id)}
                                >
                                    <CloseIcon />
                                </Button>
                            </div>
                        </div>
                        <FormationGrid formation={encounter.formation} />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EncounterList;
