import React, { useState } from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { StatPriorityForm } from '../stats/StatPriorityForm';
import {
    Button,
    Select,
    Checkbox,
    CloseIcon,
    Input,
    Tooltip,
    InfoIcon,
    CollapsibleForm,
    ChevronDownIcon,
} from '../ui';
import { AutogearAlgorithm, AUTOGEAR_STRATEGIES } from '../../utils/autogear/AutogearStrategy';
import { Ship } from '../../types/ship';
import { StatPriority } from '../../types/autogear';
import { SHIP_TYPES, ShipTypeName, STATS } from '../../constants';
import { GearSetName, GEAR_SETS } from '../../constants/gearSets';
import { SetPriority } from '../../types/autogear';

interface AutogearSettingsProps {
    selectedShip: Ship | null;
    selectedShipRole: ShipTypeName | null;
    selectedAlgorithm: AutogearAlgorithm;
    priorities: StatPriority[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    showSecondaryRequirements: boolean;
    setPriorities: SetPriority[];
    onShipSelect: (ship: Ship) => void;
    onRoleSelect: (role: ShipTypeName) => void;
    onAlgorithmSelect: (algorithm: AutogearAlgorithm) => void;
    onAddPriority: (priority: StatPriority) => void;
    onRemovePriority: (index: number) => void;
    onFindOptimalGear: () => void;
    onIgnoreEquippedChange: (value: boolean) => void;
    onIgnoreUnleveledChange: (value: boolean) => void;
    onToggleSecondaryRequirements: (value: boolean) => void;
    onAddSetPriority: (priority: SetPriority) => void;
    onRemoveSetPriority: (index: number) => void;
}

const SetPriorityForm: React.FC<{
    onAdd: (priority: SetPriority) => void;
}> = ({ onAdd }) => {
    const [selectedSet, setSelectedSet] = useState<string>('');
    const [count, setCount] = useState<number>(2);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedSet) {
            onAdd({ setName: selectedSet, count });
            setSelectedSet('');
            setCount(2);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex gap-4 items-end">
                <Select
                    label="Gear set"
                    className="flex-1"
                    options={Object.entries(GEAR_SETS).map(([key, set]) => ({
                        value: key,
                        label: set.name,
                    }))}
                    value={selectedSet}
                    onChange={(value) => setSelectedSet(value)}
                    noDefaultSelection
                    helpLabel="Select a gear set to be met by the gear you equip."
                />
                <Input
                    label="No. of pieces"
                    type="number"
                    min="2"
                    max="6"
                    value={count}
                    onChange={(e) => setCount(parseInt(e.target.value))}
                    helpLabel="Set the number of pieces in the gear set to be met by the gear you equip."
                />
                <Button type="submit" disabled={!selectedSet} variant="secondary">
                    Add
                </Button>
            </div>
        </form>
    );
};

export const AutogearSettings: React.FC<AutogearSettingsProps> = ({
    selectedShip,
    selectedShipRole,
    selectedAlgorithm,
    priorities,
    ignoreEquipped,
    ignoreUnleveled,
    showSecondaryRequirements,
    setPriorities,
    onShipSelect,
    onRoleSelect,
    onAlgorithmSelect,
    onAddPriority,
    onRemovePriority,
    onFindOptimalGear,
    onIgnoreEquippedChange,
    onIgnoreUnleveledChange,
    onToggleSecondaryRequirements,
    onAddSetPriority,
    onRemoveSetPriority,
}) => {
    const [showSecondaryRequirementsTooltip, setShowSecondaryRequirementsTooltip] =
        useState<boolean>(false);

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold ">Settings</h3>
            <ShipSelector onSelect={onShipSelect} selected={selectedShip} />

            <div className="p-4 bg-dark space-y-2">
                <span className=" text-sm">Predefined Strategies</span>
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
                    <Button
                        variant="link"
                        onClick={() => onToggleSecondaryRequirements(!showSecondaryRequirements)}
                        className="w-full flex justify-between items-center"
                    >
                        <span className="flex items-center gap-2">
                            <ChevronDownIcon
                                className={`text-sm text-gray-400 h-8 w-8 p-2 transition-transform duration-300 ${
                                    showSecondaryRequirements ? 'rotate-180' : ''
                                }`}
                            />
                            {showSecondaryRequirements ? 'Hide' : 'Show'} Secondary Priorities
                        </span>

                        <InfoIcon
                            className="text-sm text-gray-400 h-8 w-8 p-2"
                            onMouseEnter={() => setShowSecondaryRequirementsTooltip(true)}
                            onMouseLeave={() => setShowSecondaryRequirementsTooltip(false)}
                        />
                    </Button>
                    <Tooltip
                        isVisible={showSecondaryRequirementsTooltip}
                        className="bg-dark border border-dark-lighter p-2 w-[80%] max-w-[400px]"
                    >
                        <p>
                            Add additional minimum/maximum stat requirements, or wanted set pieces
                            to the predefined role. These are soft capped and will penalize the
                            score relatively if not met. <br />
                            <br />
                            For example higher hacking, speed targets, cap crit going over 100% for
                            stats, or best attacker score with 2 stealth pieces.
                        </p>
                    </Tooltip>
                </div>
            )}

            <CollapsibleForm
                isVisible={
                    selectedShipRole === null ||
                    selectedShipRole === '' ||
                    showSecondaryRequirements
                }
                className="!mt-0"
            >
                <div className="space-y-4">
                    <StatPriorityForm
                        onAdd={onAddPriority}
                        existingPriorities={priorities}
                        hideWeight={showSecondaryRequirements}
                    />

                    <div className="bg-dark p-4 space-y-2">
                        <SetPriorityForm onAdd={onAddSetPriority} />
                    </div>
                </div>
            </CollapsibleForm>

            {priorities.length > 0 && (
                <div className="bg-dark p-4 space-y-2 ">
                    <h3 className="text-lg font-semibold">Stat Priority List</h3>
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

            {setPriorities.length > 0 && (
                <div className="bg-dark p-4 space-y-2">
                    <h3 className="text-lg font-semibold">Set Priority List</h3>
                    {setPriorities.map((priority, index) => (
                        <div key={index} className="flex items-center">
                            <span>
                                {GEAR_SETS[priority.setName as GearSetName].name} ({priority.count}{' '}
                                pieces)
                            </span>
                            <Button
                                aria-label="Remove set priority"
                                variant="danger"
                                size="sm"
                                onClick={() => onRemoveSetPriority(index)}
                                className="ml-auto"
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2 p-4 bg-dark">
                <Select
                    label="Algorithm"
                    data-testid="algorithm-select"
                    options={Object.entries(AUTOGEAR_STRATEGIES).map(([key, { name }]) => ({
                        value: key,
                        label: name,
                    }))}
                    value={selectedAlgorithm}
                    onChange={(value) => onAlgorithmSelect(value as AutogearAlgorithm)}
                    helpLabel="Select the algorithm to use for finding the optimal gear. The default genetic algorithm is recommended."
                />
                <p className="text-sm text-gray-400">
                    {AUTOGEAR_STRATEGIES[selectedAlgorithm].description}
                </p>
            </div>

            <div className="p-4 bg-dark space-y-4">
                <Checkbox
                    label="Ignore currently equipped gear"
                    checked={ignoreEquipped}
                    onChange={(value) => onIgnoreEquippedChange(value)}
                    helpLabel="When checked, the algorithm will ignore gear that is currently equipped on other
                    ships.
                    Unchecked, the algorithm will include gear that is currently equipped on other
                    ships, except those you have locked."
                    className="w-full"
                />
                <Checkbox
                    label="Ignore unleveled gear"
                    checked={ignoreUnleveled}
                    onChange={(value) => onIgnoreUnleveledChange(value)}
                    helpLabel="When checked, the algorithm will ignore gear that has not been leveled up (level 0).
                    Unchecked, the algorithm will consider all gear regardless of level."
                    className="w-full"
                />
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
