import React from 'react';
import { Ship, Implant } from '../../types/ship';
import { Button } from '../ui';
import { StatModifierInput } from '../stats/StatModifierInput';
import { CloseIcon } from '../ui';

interface ImplantTestingProps {
    ship: Ship;
    temporaryImplants: Implant[];
    onImplantsChange: (implants: Implant[]) => void;
    onSaveChanges: () => void;
    onResetChanges: () => void;
    hasChanges: boolean;
}

export const ImplantTesting: React.FC<ImplantTestingProps> = ({
    ship,
    temporaryImplants,
    onImplantsChange,
    onSaveChanges,
    onResetChanges,
    hasChanges,
}) => {
    const handleImplantDelete = (index: number) => {
        onImplantsChange(temporaryImplants.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-4">
            <h4 className="font-semibold">Implants</h4>
            <div className="p-4 bg-dark">
                {temporaryImplants.map((implant, index) => (
                    <div key={index} className="p-4 border border-gray-700 relative mb-4">
                        <div className="absolute top-4 right-4">
                            <Button
                                aria-label="Delete implant"
                                size="sm"
                                variant="danger"
                                onClick={() => handleImplantDelete(index)}
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                        <StatModifierInput
                            stats={implant.stats}
                            onChange={(newStats) => {
                                const newImplants = [...temporaryImplants];
                                newImplants[index] = { ...implant, stats: newStats };
                                onImplantsChange(newImplants);
                            }}
                            maxStats={2}
                            alwaysColumn
                            defaultExpanded={false}
                        />
                    </div>
                ))}

                {temporaryImplants.length < 5 && (
                    <Button
                        aria-label="Add implant"
                        type="button"
                        variant="primary"
                        onClick={() => onImplantsChange([...temporaryImplants, { stats: [] }])}
                    >
                        Add Implant
                    </Button>
                )}

                {hasChanges && (
                    <div className="flex gap-2 mt-4 justify-end">
                        <Button variant="primary" onClick={onSaveChanges}>
                            Save Implants
                        </Button>
                        <Button variant="secondary" onClick={onResetChanges}>
                            Reset
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
