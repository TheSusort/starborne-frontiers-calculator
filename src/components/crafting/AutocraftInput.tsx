import React from 'react';
import { CraftingMaterials } from '../../types/crafting';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES, RarityName } from '../../constants/rarities';
import { SHIP_TYPES, ShipTypeName } from '../../constants';
import { Input } from '../ui/Input';
import { CheckboxGroup } from '../ui/CheckboxGroup';

interface Props {
    materials: CraftingMaterials;
    onMaterialsChange: (materials: CraftingMaterials) => void;
    selectedRoles: ShipTypeName[];
    onRolesChange: (roles: ShipTypeName[]) => void;
}

const CRAFTABLE_SETS = ['omnicore', 'swiftness', 'recovery', 'exploit'] as const;
const RARITY_OPTIONS = Object.entries(RARITIES)
    .filter(([key]) => ['rare', 'epic', 'legendary'].includes(key))
    .map(([key, rarity]) => ({
        value: key,
        label: rarity.label,
    }));

export const AutocraftInput: React.FC<Props> = ({
    materials,
    onMaterialsChange,
    selectedRoles,
    onRolesChange,
}) => {
    // Ensure boosters structure is properly initialized
    const safeMaterials: CraftingMaterials = {
        ...materials,
        boosters: materials.boosters || {
            rank: 0,
            rarity: 0,
            substat: {
                speed: 0,
                crit_power: 0,
                hacking: 0,
                crit_rate: 0,
                security: 0,
                attack: 0,
                hp: 0,
                defense: 0,
            },
        },
    };

    const roleOptions = Object.entries(SHIP_TYPES).map(([key, type]) => ({
        value: key,
        label: type.name,
    }));

    const updateSlotItem = (slot: keyof CraftingMaterials['slotItems'], value: number) => {
        onMaterialsChange({
            ...safeMaterials,
            slotItems: {
                ...safeMaterials.slotItems,
                [slot]: Math.max(0, value),
            },
        });
    };

    const updateSetCore = (
        set: (typeof CRAFTABLE_SETS)[number],
        rarity: RarityName,
        value: number
    ) => {
        onMaterialsChange({
            ...safeMaterials,
            setCores: {
                ...safeMaterials.setCores,
                [set]: {
                    ...safeMaterials.setCores[set],
                    [rarity]: Math.max(0, value),
                },
            },
        });
    };

    const updateSetMaterial = (
        type: 'synth_alloy' | 'quantum_fiber',
        rarity: RarityName,
        value: number
    ) => {
        onMaterialsChange({
            ...safeMaterials,
            setMaterials: {
                ...safeMaterials.setMaterials,
                [type]: {
                    ...safeMaterials.setMaterials[type],
                    [rarity]: Math.max(0, value),
                },
            },
        });
    };

    const updateBooster = (type: 'rank' | 'rarity', value: number) => {
        onMaterialsChange({
            ...safeMaterials,
            boosters: {
                ...safeMaterials.boosters,
                [type]: Math.max(0, value),
            },
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Crafting Materials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                        <Input
                            key={key}
                            type="number"
                            label={slot.label}
                            min={0}
                            value={safeMaterials.slotItems[
                                key as keyof CraftingMaterials['slotItems']
                            ].toString()}
                            onChange={(e) =>
                                updateSlotItem(
                                    key as keyof CraftingMaterials['slotItems'],
                                    parseInt(e.target.value) || 0
                                )
                            }
                        />
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-lg font-semibold mb-4">Set Cores</h3>
                <div className="space-y-4">
                    {CRAFTABLE_SETS.map((set) => (
                        <div key={set} className="bg-dark p-4 border border-dark-border">
                            <h4 className="font-medium mb-2 capitalize">{set}</h4>
                            <div className="grid grid-cols-3 gap-4">
                                {RARITY_OPTIONS.map((rarity) => (
                                    <Input
                                        key={rarity.value}
                                        type="number"
                                        label={rarity.label}
                                        min={0}
                                        value={safeMaterials.setCores[set][
                                            rarity.value as RarityName
                                        ].toString()}
                                        onChange={(e) =>
                                            updateSetCore(
                                                set,
                                                rarity.value as RarityName,
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-lg font-semibold mb-4">Set Materials</h3>
                <div className="space-y-4">
                    {(['synth_alloy', 'quantum_fiber'] as const).map((materialType) => (
                        <div key={materialType} className="bg-dark p-4 border border-dark-border">
                            <h4 className="font-medium mb-2">
                                {materialType === 'synth_alloy' ? 'Synth Alloy' : 'Quantum Fiber'}
                            </h4>
                            <div className="grid grid-cols-3 gap-4">
                                {RARITY_OPTIONS.map((rarity) => (
                                    <Input
                                        key={rarity.value}
                                        type="number"
                                        label={rarity.label}
                                        min={0}
                                        value={safeMaterials.setMaterials[materialType][
                                            rarity.value as RarityName
                                        ].toString()}
                                        onChange={(e) =>
                                            updateSetMaterial(
                                                materialType,
                                                rarity.value as RarityName,
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h3 className="text-lg font-semibold mb-4">
                    Boosters (Optional - 1 consumed per craft)
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    Rank and Rarity boosters will only be used for Sensors, Software, and Thrusters
                    slots. Substat boosters are currently disabled.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        type="number"
                        label="Rank Booster"
                        min={0}
                        value={safeMaterials.boosters.rank.toString()}
                        onChange={(e) => updateBooster('rank', parseInt(e.target.value) || 0)}
                        helpLabel="Doubles the chances of 5★ and 6★ gear at the expense of 4★ (used for Sensors/Software/Thrusters only)"
                    />
                    <Input
                        type="number"
                        label="Rarity Booster"
                        min={0}
                        value={safeMaterials.boosters.rarity.toString()}
                        onChange={(e) => updateBooster('rarity', parseInt(e.target.value) || 0)}
                        helpLabel="Doubles the chances of Epic and Legendary gear at the expense of Rare (used for Sensors/Software/Thrusters only)"
                    />
                </div>
            </div>

            <div>
                <h3 className="text-lg font-semibold mb-4">Roles to Improve</h3>
                <CheckboxGroup
                    label="Select roles to prioritize when distributing materials"
                    values={selectedRoles}
                    onChange={(values) => onRolesChange(values as ShipTypeName[])}
                    options={roleOptions}
                />
            </div>
        </div>
    );
};
