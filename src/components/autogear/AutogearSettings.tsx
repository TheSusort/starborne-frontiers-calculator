import React, { useState, useRef, useEffect } from 'react';
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
    RoleSelector,
} from '../ui';
import { useTutorialTrigger } from '../../hooks/useTutorialTrigger';
import { useTutorial } from '../../contexts/TutorialContext';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { Ship } from '../../types/ship';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName, STATS } from '../../constants';
import { GEAR_SETS } from '../../constants/gearSets';
import { StatName } from '../../types/stats';
import { ArenaSeason } from '../../types/arena';
import { StatBonusForm } from './StatBonusForm';

function formatRuleSummary(rule: {
    factions: string[] | null;
    rarities: string[] | null;
    ship_types: string[] | null;
}): string {
    const parts: string[] = [];
    if (rule.rarities?.length) parts.push(rule.rarities.join('/'));
    if (rule.ship_types?.length)
        parts.push(rule.ship_types.map((t) => t.toLowerCase().replace(/_/g, ' ')).join('/'));
    if (rule.factions?.length) parts.push(`from ${rule.factions.join('/')}`);
    return parts.length > 0 ? parts.join(' ') : 'All units';
}

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
    includeCalibratedGear: boolean;
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
    onIncludeCalibratedGearChange: (value: boolean) => void;
    onResetConfig: () => void;
    activeSeason?: ArenaSeason | null;
    useArenaModifiers?: boolean;
    onUseArenaModifiersChange?: (value: boolean) => void;
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
    priorities,
    ignoreEquipped,
    ignoreUnleveled,
    showSecondaryRequirements,
    setPriorities,
    statBonuses,
    useUpgradedStats,
    tryToCompleteSets,
    optimizeImplants,
    includeCalibratedGear,
    onRoleSelect,
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
    onIncludeCalibratedGearChange,
    onResetConfig,
    activeSeason,
    useArenaModifiers,
    onUseArenaModifiersChange,
}) => {
    const [showSecondaryRequirementsTooltip, setShowSecondaryRequirementsTooltip] =
        useState<boolean>(false);
    const secondaryRequirementsTooltipRef = useRef<HTMLDivElement>(null);

    useTutorialTrigger('autogear-settings');

    // Auto-expand secondary priorities when the settings tutorial is active
    const { activeGroup } = useTutorial();
    useEffect(() => {
        if (
            activeGroup?.id === 'autogear-settings' &&
            selectedShipRole &&
            !showSecondaryRequirements
        ) {
            onToggleSecondaryRequirements(true);
        }
    }, [activeGroup, selectedShipRole, showSecondaryRequirements, onToggleSecondaryRequirements]);

    return (
        <div className="space-y-4">
            <div className="card space-y-2" data-tutorial="autogear-role-selector">
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
                <RoleSelector
                    value={selectedShipRole || ''}
                    onChange={onRoleSelect}
                    noDefaultSelection
                    defaultOption="Manual"
                />
            </div>

            {selectedShipRole && (
                <div className="card">
                    <Button
                        variant="link"
                        onClick={() => onToggleSecondaryRequirements(!showSecondaryRequirements)}
                        className="w-full flex justify-between items-center"
                    >
                        <span className="flex items-center gap-2">
                            <ChevronDownIcon
                                className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${
                                    showSecondaryRequirements ? 'rotate-180' : ''
                                }`}
                            />
                            {showSecondaryRequirements ? 'Hide' : 'Show'} Secondary Priorities
                        </span>

                        <div
                            ref={secondaryRequirementsTooltipRef}
                            onMouseEnter={() => setShowSecondaryRequirementsTooltip(true)}
                            onMouseLeave={() => setShowSecondaryRequirementsTooltip(false)}
                        >
                            <InfoIcon className="text-sm text-theme-text-secondary h-8 w-8 p-2" />
                        </div>
                    </Button>
                    <Tooltip
                        isVisible={showSecondaryRequirementsTooltip}
                        className="bg-dark border border-dark-lighter p-2 w-[80%] max-w-[400px]"
                        targetElement={secondaryRequirementsTooltipRef.current}
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
                    <div data-tutorial="autogear-stat-priorities">
                        <StatPriorityForm
                            onAdd={onAddPriority}
                            existingPriorities={priorities}
                            hideWeight={showSecondaryRequirements}
                        />
                    </div>

                    <div className="card space-y-2" data-tutorial="autogear-set-priorities">
                        <SetPriorityForm onAdd={onAddSetPriority} />
                    </div>

                    <div className="card space-y-2" data-tutorial="autogear-stat-bonuses">
                        <h3 className="font-semibold">Stat Bonuses</h3>
                        <p className="text-sm text-theme-text-secondary">
                            Add stat bonuses that contribute to the role score.
                            <strong> Additive</strong> adds stat × % directly (e.g., defense@80% for
                            a skill dealing 80% of defense as damage).
                            <strong> Multiplier</strong> multiplies the role score by stat × %
                            (e.g., hacking@50% makes DPS scale with hacking).
                        </p>
                        <StatBonusForm
                            onAdd={onAddStatBonus}
                            existingBonuses={statBonuses}
                            onRemove={onRemoveStatBonus}
                        />
                    </div>
                </div>
            </CollapsibleForm>

            <div className="card space-y-2">
                <h3 className="font-semibold">Options</h3>
                <div className="space-y-2">
                    <div data-tutorial="autogear-ignore-options">
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
                    </div>
                    <div data-tutorial="autogear-upgrade-options">
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
                    </div>
                    <div data-tutorial="autogear-extra-options">
                        <Checkbox
                            id="optimizeImplants"
                            label="Optimize implants (EXPERIMENTAL)"
                            checked={optimizeImplants}
                            onChange={onOptimizeImplantsChange}
                            helpLabel="When enabled, the autogear algorithm will also optimize implants (Major and 3 Minor slots). Ultimate implants are not optimized but will be displayed."
                        />
                        <Checkbox
                            id="includeCalibratedGear"
                            label="Include calibrated gear"
                            checked={includeCalibratedGear}
                            onChange={onIncludeCalibratedGearChange}
                            helpLabel="When enabled, gear calibrated to other ships will be included in the search. These will be scored using base stats (without calibration bonus)."
                        />
                        {activeSeason && (
                            <div className="space-y-2">
                                <Checkbox
                                    id="useArenaModifiers"
                                    label="Apply arena modifiers"
                                    checked={useArenaModifiers || false}
                                    onChange={() => onUseArenaModifiersChange?.(!useArenaModifiers)}
                                    helpLabel="Apply the active arena season's stat modifiers to scoring."
                                />
                                {useArenaModifiers && (
                                    <div className="ml-6 text-xs text-slate-400 space-y-1">
                                        <div className="font-medium text-slate-300">
                                            {activeSeason.name}
                                            {activeSeason.ends_at && (
                                                <span className="text-slate-500">
                                                    {' '}
                                                    (ends{' '}
                                                    {new Date(
                                                        activeSeason.ends_at
                                                    ).toLocaleDateString()}
                                                    )
                                                </span>
                                            )}
                                        </div>
                                        {activeSeason.rules.map((rule) => (
                                            <div key={rule.id} className="text-slate-500">
                                                {formatRuleSummary(rule)}:{' '}
                                                {Object.entries(rule.modifiers)
                                                    .map(
                                                        ([stat, val]) =>
                                                            `${stat} ${val > 0 ? '+' : ''}${val}%`
                                                    )
                                                    .join(', ')}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {(statBonuses.length > 0 || priorities.length > 0 || setPriorities.length > 0) && (
                <div className="card space-y-2">
                    {statBonuses.length > 0 && (
                        <>
                            <h3 className="font-semibold">Role Stat Bonuses</h3>
                            {statBonuses.map((bonus, index) => (
                                <div key={index} className="flex items-center text-sm">
                                    <span>
                                        {STATS[bonus.stat as StatName].label} ({bonus.percentage}%)
                                        {' — '}
                                        <span className="text-xs text-theme-text-secondary">
                                            {bonus.mode === 'multiplier'
                                                ? 'Multiplier'
                                                : 'Additive'}
                                        </span>
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
