import React, { useState } from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { StatPriorityForm } from '../stats/StatPriorityForm';
import { StatBonusForm } from './StatBonusForm';
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
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { SHIP_TYPES, ShipTypeName, STATS } from '../../constants';
import { GEAR_SETS } from '../../constants/gearSets';
import { StatName } from '../../types/stats';

interface AutogearSettingsProps {
    selectedShip: Ship | null;
    selectedShipRole: ShipTypeName | null;
    selectedAlgorithm: AutogearAlgorithm;
    priorities: StatPriority[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    showSecondaryRequirements: boolean;
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    optimizeImplants: boolean;
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
    onAddStatBonus: (bonus: StatBonus) => void;
    onRemoveStatBonus: (index: number) => void;
    onUseUpgradedStatsChange: (value: boolean) => void;
    onTryToCompleteSetsChange: (value: boolean) => void;
    onOptimizeImplantsChange: (value: boolean) => void;
    onResetConfig: () => void;
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
                <div className="w-32">
                    <Input
                        label="No. of pieces"
                        type="number"
                        min="0"
                        max="6"
                        value={count}
                        onChange={(e) => setCount(parseInt(e.target.value))}
                        helpLabel="Set the number of pieces in the gear set to be met by the gear you equip."
                    />
                </div>
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
    statBonuses,
    useUpgradedStats,
    tryToCompleteSets,
    optimizeImplants,
    onRoleSelect,
    onAlgorithmSelect,
    onAddPriority,
    onRemovePriority,
    onIgnoreEquippedChange,
    onIgnoreUnleveledChange,
    onToggleSecondaryRequirements,
    onAddSetPriority,
    onRemoveSetPriority,
    onAddStatBonus,
    onRemoveStatBonus,
    onUseUpgradedStatsChange,
    onTryToCompleteSetsChange,
    onOptimizeImplantsChange,
    onResetConfig,
}) => {
    const [showSecondaryRequirementsTooltip, setShowSecondaryRequirementsTooltip] =
        useState<boolean>(false);

    return (
        <div className="space-y-4">
            <div className="p-4 bg-dark space-y-2">
                <div className="flex justify-between items-center">
                    <span className="text-sm">Predefined Strategies</span>
                    {selectedShip && (
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={onResetConfig}
                            className="text-xs"
                        >
                            Reset Configuration
                        </Button>
                    )}
                </div>
                <Select
                    data-testid="role-select"
                    options={Object.entries(SHIP_TYPES).map(([key, type]) => ({
                        value: key,
                        label: `${type.name} (${type.description})`,
                    }))}
                    value={selectedShipRole || ''}
                    onChange={(value) => onRoleSelect(value as ShipTypeName)}
                    noDefaultSelection
                    defaultOption="Manual"
                />
            </div>

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

                    <div className="bg-dark p-4 space-y-2">
                        <h3 className="font-semibold">Stat Bonuses</h3>
                        <p className="text-sm text-gray-400">
                            Add stat bonuses that contribute to the role score. These are additive
                            adjustments (typically &lt;5% of total score) for hybrid builds or
                            skill-specific scaling. Example: Defender with hacking @ 80% for debuff
                            capability, or attacker with HP @ 5% for HP-scaling skills.
                        </p>
                        <StatBonusForm
                            onAdd={onAddStatBonus}
                            existingBonuses={statBonuses}
                            onRemove={onRemoveStatBonus}
                        />
                    </div>
                </div>
            </CollapsibleForm>

            <div className="bg-dark p-4 space-y-2">
                <h3 className="font-semibold">Options</h3>
                <div className="space-y-2">
                    <Checkbox
                        id="ignoreEquipped"
                        label="Ignore equipped gear on other ships"
                        checked={ignoreEquipped}
                        onChange={onIgnoreEquippedChange}
                        helpLabel="When enabled, the autogear algorithm will ignore equipped gear on other ships. When disabled, it will include already equipped gear, except from ships with locked state, in the search."
                    />
                    <Checkbox
                        id="ignoreUnleveled"
                        label="Ignore unleveled gear"
                        checked={ignoreUnleveled}
                        onChange={onIgnoreUnleveledChange}
                        helpLabel="When enabled, the autogear algorithm will ignore unleveled gear. Disable if you want to include unleveled gear in the search, this also applies to simulated upgraded gear."
                    />
                    <Checkbox
                        id="useUpgradedStats"
                        label="Use upgraded stats"
                        checked={useUpgradedStats}
                        onChange={onUseUpgradedStatsChange}
                        helpLabel="When enabled, the autogear algorithm will use the upgraded stats of gear pieces if they exist."
                    />
                    <Checkbox
                        id="tryToCompleteSets"
                        label="Try to complete gear sets"
                        checked={tryToCompleteSets}
                        onChange={onTryToCompleteSetsChange}
                        helpLabel="When enabled, the autogear algorithm will try to complete gear sets."
                    />
                    <Checkbox
                        id="optimizeImplants"
                        label="Optimize implants (EXPERIMENTAL)"
                        checked={optimizeImplants}
                        onChange={onOptimizeImplantsChange}
                        helpLabel="When enabled, the autogear algorithm will also optimize implants (Major and 3 Minor slots). Ultimate implants are not optimized but will be displayed."
                    />
                </div>
            </div>

            {(statBonuses.length > 0 || priorities.length > 0 || setPriorities.length > 0) && (
                <div className="bg-dark p-4 space-y-2">
                    {statBonuses.length > 0 && (
                        <>
                            <h3 className="font-semibold">Role Stat Bonuses</h3>
                            {statBonuses.map((bonus, index) => (
                                <div key={index} className="flex items-center text-sm">
                                    <span>
                                        {STATS[bonus.stat as StatName].label} ({bonus.percentage}%)
                                    </span>
                                    <Button
                                        aria-label="Remove bonus"
                                        variant="danger"
                                        size="sm"
                                        onClick={() => onRemoveStatBonus(index)}
                                        className="ml-auto"
                                    >
                                        <CloseIcon />
                                    </Button>
                                </div>
                            ))}
                            <hr className="my-2 border-dark-lighter" />
                        </>
                    )}

                    {priorities.length > 0 && (
                        <>
                            <h3 className="font-semibold">Stat Priority List</h3>
                            {priorities.map((priority, index) => (
                                <div key={index} className="flex items-center text-sm">
                                    <span>
                                        {STATS[priority.stat].label}
                                        {priority.minLimit && ` (min: ${priority.minLimit})`}
                                        {priority.maxLimit && ` (max: ${priority.maxLimit})`}
                                        {priority.hardRequirement && ' (HARD)'}
                                        {priority.weight &&
                                            priority.weight !== 1 &&
                                            ` (weight: ${priority.weight})`}
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
                            <hr className="my-2 border-dark-lighter" />
                        </>
                    )}

                    {setPriorities.length > 0 && (
                        <>
                            <h3 className="font-semibold">Set Priority List</h3>
                            {setPriorities.map((priority, index) => (
                                <div key={index} className="flex items-center text-sm">
                                    <span>
                                        {GEAR_SETS[priority.setName].name} ({priority.count} pieces)
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
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
