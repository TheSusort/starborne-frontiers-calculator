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
    hideMaxLimit?: boolean;
    hideMinLimit?: boolean;
    editingValue?: StatPriority;
    onSave?: (priority: StatPriority) => void;
    onCancel?: () => void;
}

export const StatPriorityForm: React.FC<Props> = ({
    onAdd,
    hideMaxLimit,
    hideMinLimit,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName>(AVAILABLE_STATS[0]);
    const [maxLimit, setMaxLimit] = useState<string>('');
    const [minLimit, setMinLimit] = useState<string>('');
    const [hardRequirement, setHardRequirement] = useState<boolean>(false);
    const [showHardTooltip, setShowHardTooltip] = useState<boolean>(false);
    const hardLabelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat);
            setMinLimit(editingValue.minLimit !== undefined ? String(editingValue.minLimit) : '');
            setMaxLimit(editingValue.maxLimit !== undefined ? String(editingValue.maxLimit) : '');
            setHardRequirement(editingValue.hardRequirement ?? false);
        } else {
            setSelectedStat(AVAILABLE_STATS[0]);
            setMinLimit('');
            setMaxLimit('');
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
            weight: 1,
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
        setSelectedStat(AVAILABLE_STATS[0]);
    };

    const limitsShown = !hideMinLimit || !hideMaxLimit;

    return (
        <form onSubmit={handleSubmit} className="space-y-3" role="form">
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as StatName)}
                    options={AVAILABLE_STATS.map((stat) => ({
                        value: stat,
                        label: STATS[stat].label,
                    }))}
                    helpLabel="Set a stat priority to be met by the gear you equip. A min or max value is required."
                />
                {!hideMinLimit && (
                    <div className="w-24">
                        <Input
                            label="Min"
                            type="number"
                            value={minLimit}
                            onChange={(e) => setMinLimit(e.target.value)}
                            placeholder="—"
                        />
                    </div>
                )}
                {!hideMaxLimit && (
                    <div className="w-24">
                        <Input
                            label="Max"
                            type="number"
                            value={maxLimit}
                            onChange={(e) => setMaxLimit(e.target.value)}
                            placeholder="—"
                        />
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
                {limitsShown ? (
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
                ) : (
                    <span />
                )}
                <Tooltip
                    isVisible={showHardTooltip && hardRequirement}
                    targetElement={hardLabelRef.current}
                    className="bg-dark border border-dark-lighter p-2"
                >
                    <p className="text-xs">
                        Skip the entire suggestion if this stat target isn&apos;t reachable.
                    </p>
                </Tooltip>
                {editingValue ? (
                    <div className="flex gap-2">
                        <Button
                            aria-label="Cancel edit"
                            type="button"
                            variant="secondary"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                        <Button aria-label="Save priority" type="submit" variant="primary">
                            Save
                        </Button>
                    </div>
                ) : (
                    <Button aria-label="Add priority" type="submit" variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
