import React, { useState, useEffect } from 'react';
import { StatPriorityForm } from '../stats/StatPriorityForm';
import {
    Button,
    Select,
    Checkbox,
    Input,
    CollapsibleAccordion,
    ChevronDownIcon,
    ResetIcon,
    RoleSelector,
} from '../ui';
import { useTutorialTrigger } from '../../hooks/useTutorialTrigger';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { Ship } from '../../types/ship';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { GEAR_SETS } from '../../constants/gearSets';
import { ArenaSeason } from '../../types/arena';
import { StatBonusForm } from './StatBonusForm';
import { StatPriorityRow } from './StatPriorityRow';
import { SetPriorityRow } from './SetPriorityRow';
import { StatBonusRow } from './StatBonusRow';

type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus'; editIndex: number | null };

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
    onUpdatePriority: (index: number, priority: StatPriority) => void;
    onRemovePriority: (index: number) => void;
    onMovePriority: (fromIndex: number, toIndex: number) => void;
    onFindOptimalGear: () => void;
    onIgnoreEquippedChange: (value: boolean) => void;
    onIgnoreUnleveledChange: (value: boolean) => void;
    onToggleSecondaryRequirements: (value: boolean) => void;
    onAddSetPriority: (priority: SetPriority) => void;
    onUpdateSetPriority: (index: number, priority: SetPriority) => void;
    onRemoveSetPriority: (index: number) => void;
    onMoveSetPriority: (fromIndex: number, toIndex: number) => void;
    onAddStatBonus: (bonus: StatBonus) => void;
    onUpdateStatBonus: (index: number, bonus: StatBonus) => void;
    onRemoveStatBonus: (index: number) => void;
    onMoveStatBonus: (fromIndex: number, toIndex: number) => void;
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
    editingValue?: SetPriority;
    onSave?: (priority: SetPriority) => void;
    onCancel?: () => void;
}> = ({ onAdd, editingValue, onSave, onCancel }) => {
    const [selectedSet, setSelectedSet] = useState<string>('');
    const [count, setCount] = useState<number>(2);

    useEffect(() => {
        if (editingValue) {
            setSelectedSet(editingValue.setName);
            setCount(editingValue.count);
        } else {
            setSelectedSet('');
            setCount(2);
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedSet) return;
        const value = { setName: selectedSet, count };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedSet('');
        setCount(2);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Gear set"
                    className="flex-1 min-w-[8rem]"
                    options={Object.entries(GEAR_SETS).map(([key, set]) => ({
                        value: key,
                        label: set.name,
                    }))}
                    value={selectedSet}
                    onChange={(value) => setSelectedSet(value)}
                    noDefaultSelection
                    helpLabel="Select a gear set to be met by the gear you equip."
                />
                <div className="w-24">
                    <Input
                        label="No. of pieces"
                        type="number"
                        min="0"
                        max="6"
                        value={count}
                        onChange={(e) => setCount(parseInt(e.target.value))}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-2 flex-wrap">
                {editingValue ? (
                    <>
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!selectedSet} variant="primary">
                            Save
                        </Button>
                    </>
                ) : (
                    <Button type="submit" disabled={!selectedSet} variant="secondary">
                        Add
                    </Button>
                )}
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
    setPriorities,
    statBonuses,
    useUpgradedStats,
    tryToCompleteSets,
    optimizeImplants,
    includeCalibratedGear,
    onRoleSelect,
    onAddPriority,
    onUpdatePriority,
    onRemovePriority,
    onMovePriority,
    onIgnoreEquippedChange,
    onIgnoreUnleveledChange,
    onAddSetPriority,
    onUpdateSetPriority,
    onRemoveSetPriority,
    onMoveSetPriority,
    onAddStatBonus,
    onUpdateStatBonus,
    onRemoveStatBonus,
    onMoveStatBonus,
    onUseUpgradedStatsChange,
    onTryToCompleteSetsChange,
    onOptimizeImplantsChange,
    onIncludeCalibratedGearChange,
    onResetConfig,
    onFindOptimalGear,
    activeSeason,
    useArenaModifiers,
    onUseArenaModifiersChange,
}) => {
    const [tweakView, setTweakView] = useState<TweakView>({ mode: 'list' });
    const [advancedOpen, setAdvancedOpen] = useState(false);

    const openPicker = () => setTweakView({ mode: 'picker' });
    const openForm = (
        type: 'priority' | 'setPriority' | 'statBonus',
        editIndex: number | null = null
    ) => setTweakView({ mode: 'form', type, editIndex });
    const backToList = () => setTweakView({ mode: 'list' });

    const isEditingPriority = (index: number) =>
        tweakView.mode === 'form' && tweakView.type === 'priority' && tweakView.editIndex === index;
    const isEditingSetPriority = (index: number) =>
        tweakView.mode === 'form' &&
        tweakView.type === 'setPriority' &&
        tweakView.editIndex === index;
    const isEditingStatBonus = (index: number) =>
        tweakView.mode === 'form' &&
        tweakView.type === 'statBonus' &&
        tweakView.editIndex === index;

    const isSubFlow = tweakView.mode !== 'list';

    useTutorialTrigger('autogear-settings');

    const advancedEnabledCount =
        (ignoreEquipped ? 1 : 0) +
        (ignoreUnleveled ? 1 : 0) +
        (useUpgradedStats ? 1 : 0) +
        (tryToCompleteSets ? 1 : 0) +
        (optimizeImplants ? 1 : 0) +
        (includeCalibratedGear ? 1 : 0) +
        (activeSeason && useArenaModifiers ? 1 : 0);
    const advancedTotal = activeSeason ? 7 : 6;

    return (
        <div className="space-y-4">
            <div
                className={`card space-y-2 ${isSubFlow ? 'opacity-60 pointer-events-none' : ''}`}
                data-tutorial="autogear-role-selector"
            >
                <span className="text-xs uppercase tracking-wide text-theme-text-secondary">
                    Strategy
                </span>
                <div className="flex gap-2 items-end">
                    <div className="flex-1">
                        <RoleSelector
                            value={selectedShipRole || ''}
                            onChange={onRoleSelect}
                            noDefaultSelection
                            defaultOption="Manual"
                        />
                    </div>
                    {selectedShip && (
                        <Button
                            aria-label="Reset to role defaults"
                            title="Reset to role defaults"
                            variant="secondary"
                            onClick={onResetConfig}
                        >
                            <ResetIcon />
                        </Button>
                    )}
                </div>
            </div>

            {selectedShipRole && (
                <div className={`card space-y-3 ${isSubFlow ? 'ring-1 ring-primary' : ''}`}>
                    {tweakView.mode === 'list' && (
                        <div key="list" className="animate-subview-enter space-y-3">
                            <div className="flex justify-between items-center">
                                <h3 className="font-semibold">
                                    Your tweaks{' '}
                                    <span className="font-normal text-theme-text-secondary">
                                        (
                                        {priorities.length +
                                            setPriorities.length +
                                            statBonuses.length}
                                        )
                                    </span>
                                </h3>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={openPicker}
                                    data-tutorial="autogear-add-tweak"
                                >
                                    + Add tweak
                                </Button>
                            </div>

                            {priorities.length + setPriorities.length + statBonuses.length === 0 ? (
                                <p className="text-sm text-theme-text-secondary text-center py-4">
                                    No tweaks yet. The role&apos;s defaults will be used as-is.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {priorities.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                                Stat priorities
                                            </h4>
                                            {priorities.map((priority, index) => (
                                                <StatPriorityRow
                                                    key={`priority-${index}`}
                                                    priority={priority}
                                                    isEditing={isEditingPriority(index)}
                                                    canMoveUp={index > 0}
                                                    canMoveDown={index < priorities.length - 1}
                                                    onUpdate={(updated) =>
                                                        onUpdatePriority(index, updated)
                                                    }
                                                    onEdit={() => openForm('priority', index)}
                                                    onMoveUp={() =>
                                                        onMovePriority(index, index - 1)
                                                    }
                                                    onMoveDown={() =>
                                                        onMovePriority(index, index + 1)
                                                    }
                                                    onRemove={() => onRemovePriority(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {setPriorities.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                                Set requirements
                                            </h4>
                                            {setPriorities.map((priority, index) => (
                                                <SetPriorityRow
                                                    key={`set-${index}`}
                                                    priority={priority}
                                                    isEditing={isEditingSetPriority(index)}
                                                    canMoveUp={index > 0}
                                                    canMoveDown={index < setPriorities.length - 1}
                                                    onUpdate={(updated) =>
                                                        onUpdateSetPriority(index, updated)
                                                    }
                                                    onEdit={() => openForm('setPriority', index)}
                                                    onMoveUp={() =>
                                                        onMoveSetPriority(index, index - 1)
                                                    }
                                                    onMoveDown={() =>
                                                        onMoveSetPriority(index, index + 1)
                                                    }
                                                    onRemove={() => onRemoveSetPriority(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {statBonuses.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                                Boosts
                                            </h4>
                                            {statBonuses.map((bonus, index) => (
                                                <StatBonusRow
                                                    key={`bonus-${index}`}
                                                    bonus={bonus}
                                                    isEditing={isEditingStatBonus(index)}
                                                    canMoveUp={index > 0}
                                                    canMoveDown={index < statBonuses.length - 1}
                                                    onUpdate={(updated) =>
                                                        onUpdateStatBonus(index, updated)
                                                    }
                                                    onEdit={() => openForm('statBonus', index)}
                                                    onMoveUp={() =>
                                                        onMoveStatBonus(index, index - 1)
                                                    }
                                                    onMoveDown={() =>
                                                        onMoveStatBonus(index, index + 1)
                                                    }
                                                    onRemove={() => onRemoveStatBonus(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <p className="text-xs text-theme-text-secondary italic">
                                        Order matters — higher tweaks weigh more.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {tweakView.mode === 'picker' && (
                        <div key="picker" className="animate-subview-enter space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                                <Button
                                    variant="link"
                                    size="sm"
                                    onClick={backToList}
                                    className="!p-0"
                                >
                                    ← Back
                                </Button>
                                <span className="text-theme-text-secondary">·</span>
                                <span>Add tweak</span>
                            </div>
                            <h3 className="font-semibold">What do you want to add?</h3>
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
                                    onClick={() => openForm('priority')}
                                >
                                    <div className="font-semibold">Limits</div>
                                    <div className="text-xs text-theme-text-secondary">
                                        Set minimum and maximum values for a stat (e.g. minimum 120
                                        Speed).
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
                                    onClick={() => openForm('setPriority')}
                                >
                                    <div className="font-semibold">Set requirement</div>
                                    <div className="text-xs text-theme-text-secondary">
                                        Require a number of pieces from a gear set (e.g. 2×
                                        Stealth).
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
                                    onClick={() => openForm('statBonus')}
                                >
                                    <div className="font-semibold">
                                        Boost{' '}
                                        <span className="text-xs text-theme-text-secondary font-normal">
                                            (advanced)
                                        </span>
                                    </div>
                                    <div className="text-xs text-theme-text-secondary">
                                        Make scoring scale with another stat (e.g. HP +50%
                                        multiplier).
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {tweakView.mode === 'form' && (
                        <div key="form" className="animate-subview-enter space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                                <Button
                                    variant="link"
                                    size="sm"
                                    onClick={backToList}
                                    className="!p-0"
                                >
                                    ← Your tweaks
                                </Button>
                                <span className="text-theme-text-secondary">·</span>
                                <span>
                                    {tweakView.editIndex === null ? 'Add' : 'Edit'}{' '}
                                    {tweakView.type === 'priority'
                                        ? 'limits'
                                        : tweakView.type === 'setPriority'
                                          ? 'set requirement'
                                          : 'boost'}
                                </span>
                            </div>
                            {tweakView.type === 'priority' && (
                                <StatPriorityForm
                                    onAdd={(p) => {
                                        onAddPriority(p);
                                        backToList();
                                    }}
                                    editingValue={
                                        tweakView.editIndex !== null
                                            ? priorities[tweakView.editIndex]
                                            : undefined
                                    }
                                    onSave={(p) => {
                                        if (
                                            tweakView.mode === 'form' &&
                                            tweakView.editIndex !== null
                                        ) {
                                            onUpdatePriority(tweakView.editIndex, p);
                                            backToList();
                                        }
                                    }}
                                    onCancel={backToList}
                                />
                            )}
                            {tweakView.type === 'setPriority' && (
                                <SetPriorityForm
                                    onAdd={(p) => {
                                        onAddSetPriority(p);
                                        backToList();
                                    }}
                                    editingValue={
                                        tweakView.editIndex !== null
                                            ? setPriorities[tweakView.editIndex]
                                            : undefined
                                    }
                                    onSave={(p) => {
                                        if (
                                            tweakView.mode === 'form' &&
                                            tweakView.editIndex !== null
                                        ) {
                                            onUpdateSetPriority(tweakView.editIndex, p);
                                            backToList();
                                        }
                                    }}
                                    onCancel={backToList}
                                />
                            )}
                            {tweakView.type === 'statBonus' && (
                                <StatBonusForm
                                    onAdd={(b) => {
                                        onAddStatBonus(b);
                                        backToList();
                                    }}
                                    editingValue={
                                        tweakView.editIndex !== null
                                            ? statBonuses[tweakView.editIndex]
                                            : undefined
                                    }
                                    onSave={(b) => {
                                        if (
                                            tweakView.mode === 'form' &&
                                            tweakView.editIndex !== null
                                        ) {
                                            onUpdateStatBonus(tweakView.editIndex, b);
                                            backToList();
                                        }
                                    }}
                                    onCancel={backToList}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className={`card space-y-2 ${isSubFlow ? 'opacity-60 pointer-events-none' : ''}`}>
                <Button
                    variant="link"
                    onClick={() => setAdvancedOpen(!advancedOpen)}
                    className="w-full flex justify-between items-center"
                    data-tutorial="autogear-advanced-options"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDownIcon
                            className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${
                                advancedOpen ? 'rotate-180' : ''
                            }`}
                        />
                        Advanced options
                    </span>
                    <span className="text-xs text-theme-text-secondary">
                        {advancedEnabledCount} of {advancedTotal} enabled
                    </span>
                </Button>
                <CollapsibleAccordion isOpen={advancedOpen}>
                    <div className="space-y-2">
                        <div>
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
                                helpLabel="When enabled, the autogear algorithm will ignore unleveled gear. Disable to include unleveled gear at its current (level 0) stats. This filter is bypassed when Use Upgraded Stats is on, since unleveled gear is then evaluated at its simulated level-16 stats."
                            />
                        </div>
                        <div>
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
                        <div>
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
                                        onChange={() =>
                                            onUseArenaModifiersChange?.(!useArenaModifiers)
                                        }
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
                </CollapsibleAccordion>
            </div>

            {tweakView.mode === 'list' && (
                <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3">
                    <Button
                        onClick={onFindOptimalGear}
                        variant="primary"
                        className="w-full"
                        data-testid="autogear-modal-start"
                    >
                        Find Optimal Gear
                    </Button>
                </div>
            )}
            {tweakView.mode === 'picker' && (
                <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3">
                    <Button onClick={backToList} variant="secondary" className="w-full">
                        Cancel
                    </Button>
                </div>
            )}
        </div>
    );
};
