import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { StatPriorityForm } from '../stats/StatPriorityForm';
import { Button, Select, Checkbox, CloseIcon } from '../ui';
import { AutogearAlgorithm, AUTOGEAR_STRATEGIES } from '../../utils/autogear/AutogearStrategy';
import { Ship } from '../../types/ship';
import { StatPriority } from '../../types/autogear';
import { SHIP_TYPES, ShipTypeName, STATS } from '../../constants';

interface AutogearSettingsProps {
    selectedShip: Ship | null;
    selectedShipRole: ShipTypeName | null;
    selectedAlgorithm: AutogearAlgorithm;
    priorities: StatPriority[];
    ignoreEquipped: boolean;
    showSecondaryRequirements: boolean;
    onShipSelect: (ship: Ship) => void;
    onRoleSelect: (role: ShipTypeName) => void;
    onAlgorithmSelect: (algorithm: AutogearAlgorithm) => void;
    onAddPriority: (priority: StatPriority) => void;
    onRemovePriority: (index: number) => void;
    onFindOptimalGear: () => void;
    onIgnoreEquippedChange: (value: boolean) => void;
    onToggleSecondaryRequirements: (value: boolean) => void;
}

export const AutogearSettings: React.FC<AutogearSettingsProps> = ({
    selectedShip,
    selectedShipRole,
    selectedAlgorithm,
    priorities,
    ignoreEquipped,
    showSecondaryRequirements,
    onShipSelect,
    onRoleSelect,
    onAlgorithmSelect,
    onAddPriority,
    onRemovePriority,
    onFindOptimalGear,
    onIgnoreEquippedChange,
    onToggleSecondaryRequirements,
}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold ">Settings</h3>
            <ShipSelector onSelect={onShipSelect} selected={selectedShip} />

            <div className="p-4 bg-dark space-y-2">
                <span className=" text-sm">Predefined Strategies (Experimental)</span>
                <Select
                    data-testid="role-select"
                    options={Object.values(SHIP_TYPES).map((type) => ({
                        value: type.name,
                        label: `${type.name} (${type.description})`,
                    }))}
                    value={selectedShipRole || ''}
                    onChange={(value) => onRoleSelect(value as ShipTypeName)}
                    noDefaultSelection
                    defaultOption="Manual"
                />
            </div>

            {selectedShipRole && (
                <div className="p-4 bg-dark">
                    <Checkbox
                        label="Add secondary requirements"
                        checked={showSecondaryRequirements}
                        onChange={onToggleSecondaryRequirements}
                    />
                    <p className="text-sm text-gray-400 mt-1">
                        Add additional minimum/maximum stat requirements to the predefined role. For
                        example higher hacking, speed targets, cap crit going over 100%. These are
                        soft capped and will penalize the score relatively if not met.
                    </p>
                </div>
            )}

            {(selectedShipRole === null ||
                selectedShipRole === '' ||
                showSecondaryRequirements) && (
                <StatPriorityForm
                    onAdd={onAddPriority}
                    existingPriorities={priorities}
                    hideWeight={showSecondaryRequirements}
                />
            )}

            {priorities.length > 0 && (
                <div className="bg-dark p-4 space-y-2 ">
                    <h3 className="text-lg font-semibold">Priority List</h3>
                    {priorities.map((priority, index) => (
                        <div key={index} className="flex items-center">
                            <span>
                                {STATS[priority.stat].label}
                                {' ('}
                                {priority.minLimit ? `Min: ${priority.minLimit}` : ''}
                                {priority.minLimit && priority.maxLimit ? `, ` : ''}
                                {priority.maxLimit ? ` Max: ${priority.maxLimit}` : ''}
                                {priority.weight !== 1 ? ` (Weight: ${priority.weight})` : ''}
                                {') '}
                            </span>
                            <Button
                                aria-label="Remove priority"
                                variant="danger"
                                size="sm"
                                onClick={() => onRemovePriority(index)}
                                className="ml-auto"
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2 p-4 bg-dark">
                <span className=" text-sm">Algorithm</span>
                <Select
                    data-testid="algorithm-select"
                    options={Object.entries(AUTOGEAR_STRATEGIES).map(([key, { name }]) => ({
                        value: key,
                        label: name,
                    }))}
                    value={selectedAlgorithm}
                    onChange={(value) => onAlgorithmSelect(value as AutogearAlgorithm)}
                />
                <p className="text-sm text-gray-400">
                    {AUTOGEAR_STRATEGIES[selectedAlgorithm].description}
                </p>
            </div>

            <div className="p-4 bg-dark">
                <Checkbox
                    label="Ignore currently equipped gear"
                    checked={ignoreEquipped}
                    onChange={(value) => onIgnoreEquippedChange(value)}
                />
                <p className="text-sm text-gray-400 mt-1">
                    When checked, the algorithm will ignore gear that is currently equipped on other
                    ships
                </p>
            </div>

            <Button
                aria-label="Find optimal gear"
                variant="primary"
                onClick={onFindOptimalGear}
                disabled={
                    !selectedShip ||
                    ((selectedShipRole === '' || selectedShipRole === null) &&
                        priorities.length === 0)
                }
                fullWidth
            >
                Find Optimal Gear
            </Button>
        </div>
    );
};
