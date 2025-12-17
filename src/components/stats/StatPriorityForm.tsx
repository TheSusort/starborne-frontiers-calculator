import React, { useState } from 'react';
import { Button, Input, Select, Checkbox } from '../ui';
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
    hideHardRequirement?: boolean;
}

export const StatPriorityForm: React.FC<Props> = ({
    onAdd,
    existingPriorities,
    hideWeight,
    hideMaxLimit,
    hideMinLimit,
    hideHardRequirement,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName>(AVAILABLE_STATS[0]);
    const [maxLimit, setMaxLimit] = useState<string>('');
    const [minLimit, setMinLimit] = useState<string>('');
    const [weight, setWeight] = useState<number>(1);
    const [hardRequirement, setHardRequirement] = useState<boolean>(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        onAdd({
            stat: selectedStat,
            maxLimit: hideMaxLimit ? undefined : maxLimit ? Number(maxLimit) : undefined,
            minLimit: hideMinLimit ? undefined : minLimit ? Number(minLimit) : undefined,
            weight: hideWeight ? 1 : weight,
            hardRequirement: hideHardRequirement ? false : hardRequirement,
        });

        setMaxLimit('');
        setMinLimit('');
        if (!hideWeight) {
            setWeight(existingPriorities.length > 0 ? existingPriorities.length + 1 : 1);
        }
        setSelectedStat(AVAILABLE_STATS[0]);
        if (!hideHardRequirement) {
            setHardRequirement(false);
        }
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

            {!hideHardRequirement && (
                <div className="mt-4">
                    <Checkbox
                        id="hardRequirement"
                        label="Hard requirement"
                        checked={hardRequirement}
                        onChange={(checked) => setHardRequirement(checked)}
                        helpLabel="When enabled, gear combinations that don't meet this requirement will be completely excluded from results. If results are not met, it means that the stat is not achievable."
                    />
                </div>
            )}

            <div className="grow mt-4">
                <Button aria-label="Add priority" type="submit" variant="secondary" fullWidth>
                    Add
                </Button>
            </div>
        </form>
    );
};
