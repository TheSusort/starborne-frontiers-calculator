import React, { useState } from 'react';
import {
    CraftingInput as CraftingInputType,
    CraftableSet,
    SubstatBooster,
} from '../../types/crafting';
import { GearSlotName, GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES, RarityName } from '../../constants/rarities';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { SET_MATERIAL_REQUIREMENTS } from '../../constants/craftingProbabilities';

interface Props {
    value: CraftingInputType;
    onChange: (input: CraftingInputType) => void;
}

const CRAFTABLE_SETS: { value: CraftableSet; label: string }[] = [
    { value: 'omnicore', label: 'Omnicore' },
    { value: 'swiftness', label: 'Swiftness' },
    { value: 'recovery', label: 'Recovery' },
    { value: 'exploit', label: 'Exploit' },
];

const SUBSTAT_BOOSTERS: { value: SubstatBooster; label: string }[] = [
    { value: 'speed', label: 'Speed' },
    { value: 'crit_power', label: 'Crit Power' },
    { value: 'hacking', label: 'Hacking' },
    { value: 'crit_rate', label: 'Crit Rate' },
    { value: 'security', label: 'Security' },
    { value: 'attack', label: 'Attack' },
    { value: 'hp', label: 'HP' },
    { value: 'defense', label: 'Defense' },
];

export const CraftingInput: React.FC<Props> = ({ value, onChange }) => {
    const [selectedSet, setSelectedSet] = useState<CraftableSet>(value.set);

    const slotOptions = Object.entries(GEAR_SLOTS).map(([key, slot]) => ({
        value: key,
        label: slot.label,
    }));

    const rarityOptions = Object.entries(RARITIES)
        .filter(([key]) => ['rare', 'epic', 'legendary'].includes(key))
        .map(([key, rarity]) => ({
            value: key,
            label: rarity.label,
        }));

    const handleSetChange = (set: CraftableSet) => {
        setSelectedSet(set);
        onChange({
            ...value,
            set,
            // Reset material rarity if switching to a set that requires different material
            setMaterialRarity: value.setMaterialRarity,
        });
    };

    const materialType = SET_MATERIAL_REQUIREMENTS[selectedSet];
    const materialLabel = materialType === 'synth_alloy' ? 'Synth Alloy' : 'Quantum Fiber';

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                    label="Slot Type"
                    value={value.slot}
                    onChange={(val) => onChange({ ...value, slot: val as GearSlotName })}
                    options={slotOptions}
                />

                <Select
                    label="Craftable Set"
                    value={value.set}
                    onChange={(val) => handleSetChange(val as CraftableSet)}
                    options={CRAFTABLE_SETS}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                    label="Set Core Rarity"
                    value={value.setCoreRarity}
                    onChange={(val) => onChange({ ...value, setCoreRarity: val as RarityName })}
                    options={rarityOptions}
                />

                <Select
                    label={`${materialLabel} Rarity`}
                    value={value.setMaterialRarity}
                    onChange={(val) => onChange({ ...value, setMaterialRarity: val as RarityName })}
                    options={rarityOptions}
                />
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-semibold">Boosters</h3>
                <div className="space-y-3">
                    <Checkbox
                        label="Rank Booster"
                        checked={value.boosters.rank === true}
                        onChange={(checked) =>
                            onChange({
                                ...value,
                                boosters: { ...value.boosters, rank: checked },
                            })
                        }
                        helpLabel="Doubles the chances of 5★ and 6★ gear at the expense of 4★"
                    />

                    <Checkbox
                        label="Rarity Booster"
                        checked={value.boosters.rarity === true}
                        onChange={(checked) =>
                            onChange({
                                ...value,
                                boosters: { ...value.boosters, rarity: checked },
                            })
                        }
                        helpLabel="Doubles the chances of Epic and Legendary gear at the expense of Rare"
                    />

                    <div>
                        <Select
                            label="Substat Booster"
                            value={value.boosters.substat || ''}
                            onChange={(val) =>
                                onChange({
                                    ...value,
                                    boosters: {
                                        ...value.boosters,
                                        substat: val ? (val as SubstatBooster) : undefined,
                                    },
                                })
                            }
                            options={[{ value: '', label: 'None' }, ...SUBSTAT_BOOSTERS]}
                            helpLabel="Guarantees a substat of the selected type (type is still random for stats that can be flat or percentage)"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
