import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input, Select, Tooltip } from '../ui';
import { StatName } from '../../types/stats';
import { StatPriority } from '../../types/autogear';
import { STATS } from '../../constants/stats';

const AVAILABLE_STATS: StatName[] = [
    'attack',
    'defence',
    'hp',
    'speed',
    'crit',
    'critDamage',
    'hacking',
    'security',
    'healModifier',
    'shield',
];

interface Props {
    onAdd: (priority: StatPriority) => void;
    existingPriorities: StatPriority[];
    hideWeight?: boolean;
    hideMaxLimit?: boolean;
    hideMinLimit?: boolean;
    editingValue?: StatPriority;
    onSave?: (priority: StatPriority) => void;
    onCancel?: () => void;
}

export const StatPriorityForm: React.FC<Props> = ({
    onAdd,
    existingPriorities,
    hideWeight,
    hideMaxLimit,
    hideMinLimit,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName>(AVAILABLE_STATS[0]);
    const [maxLimit, setMaxLimit] = useState<string>('');
    const [minLimit, setMinLimit] = useState<string>('');
    const [weight, setWeight] = useState<number>(1);
    const [hardRequirement, setHardRequirement] = useState<boolean>(false);
    const [showHardTooltip, setShowHardTooltip] = useState<boolean>(false);
    const hardLabelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat);
            setMinLimit(editingValue.minLimit !== undefined ? String(editingValue.minLimit) : '');
            setMaxLimit(editingValue.maxLimit !== undefined ? String(editingValue.maxLimit) : '');
            setWeight(editingValue.weight ?? 1);
            setHardRequirement(editingValue.hardRequirement ?? false);
        } else {
            setSelectedStat(AVAILABLE_STATS[0]);
            setMinLimit('');
            setMaxLimit('');
            setWeight(1);
            setHardRequirement(false);
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const hasLimit = (!hideMinLimit && !!minLimit) || (!hideMaxLimit && !!maxLimit);
        const hardFlag = hasLimit && hardRequirement ? true : undefined;

        const priority: StatPriority = {
            stat: selectedStat,
            maxLimit: hideMaxLimit ? undefined : maxLimit ? Number(maxLimit) : undefined,
            minLimit: hideMinLimit ? undefined : minLimit ? Number(minLimit) : undefined,
            weight: hideWeight ? 1 : weight,
            hardRequirement: hardFlag,
        };

        if (editingValue && onSave) {
            onSave(priority);
            return;
        }

        onAdd(priority);

        setMaxLimit('');
        setMinLimit('');
        setHardRequirement(false);
        if (!hideWeight) {
            setWeight(existingPriorities.length > 0 ? existingPriorities.length + 1 : 1);
        }
        setSelectedStat(AVAILABLE_STATS[0]);
    };

    return (
        <form onSubmit={handleSubmit} className="card" role="form">
            <div className="space-y-2 flex gap-4 items-end">
                <Select
                    label="Stat"
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as StatName)}
                    options={AVAILABLE_STATS.map((stat) => ({
                        value: stat,
                        label: STATS[stat].label,
                    }))}
                    helpLabel="Set a stat priority to be met by the gear you equip. A min or max value is required."
                />
                {!hideWeight && (
                    <div className="w-32">
                        <Input
                            label="Weight"
                            type="number"
                            value={weight}
                            onChange={(e) => setWeight(Number(e.target.value))}
                            placeholder="Enter weight"
                            className="mt-4"
                            helpLabel="Set a weight for the stat priority. The higher the weight, the more important the stat is."
                        />
                    </div>
                )}
            </div>

            <div className="space-y-2 grid grid-cols-2 gap-4 items-end">
                {!hideMinLimit && (
                    <Input
                        label="Min"
                        type="number"
                        value={minLimit}
                        onChange={(e) => setMinLimit(e.target.value)}
                        placeholder="min value"
                        helpLabel="Set a minimum value for the stat priority. The gear should have a value greater than or equal to this."
                    />
                )}
                {!hideMaxLimit && (
                    <Input
                        label="Max"
                        type="number"
                        value={maxLimit}
                        onChange={(e) => setMaxLimit(e.target.value)}
                        placeholder="max value"
                        helpLabel="Set a maximum value for the stat priority. The gear should have a value less than or equal to this."
                    />
                )}
            </div>

            {(!hideMinLimit || !hideMaxLimit) && (
                <div className="mt-4">
                    <div
                        ref={hardLabelRef}
                        onMouseEnter={() => setShowHardTooltip(true)}
                        onMouseLeave={() => setShowHardTooltip(false)}
                        className="inline-block"
                    >
                        <Checkbox
                            id="hardRequirement"
                            label="Hard Requirement"
                            checked={hardRequirement}
                            onChange={setHardRequirement}
                            disabled={!minLimit && !maxLimit}
                            helpLabel="Force the optimizer to meet this limit. Unlike soft limits, hard requirements are must-meet — the optimizer will retry up to 5 times and fall back to the closest result if no combo can satisfy them."
                        />
                    </div>
                    <Tooltip
                        isVisible={showHardTooltip && hardRequirement}
                        targetElement={hardLabelRef.current}
                        className="bg-dark border border-dark-lighter p-2"
                    >
                        <p className="text-xs">this time it&apos;s personal</p>
                    </Tooltip>
                </div>
            )}

            <div className="grow mt-4">
                {editingValue ? (
                    <div className="flex gap-2">
                        <Button
                            aria-label="Save priority"
                            type="submit"
                            variant="primary"
                            fullWidth
                        >
                            Save
                        </Button>
                        <Button
                            aria-label="Cancel edit"
                            type="button"
                            variant="secondary"
                            fullWidth
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    </div>
                ) : (
                    <Button aria-label="Add priority" type="submit" variant="secondary" fullWidth>
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
