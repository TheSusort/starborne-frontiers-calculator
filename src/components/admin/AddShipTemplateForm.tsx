import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { FACTIONS } from '../../constants/factions';
import { RARITIES } from '../../constants/rarities';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { AffinityName } from '../../types/ship';

interface ShipTemplateFormData {
    name: string;
    affinity: AffinityName;
    rarity: string;
    faction: string;
    type: string;
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    critRate: number;
    critDamage: number;
    speed: number;
    hpRegen: number;
    shield: number;
    shieldPenetration: number;
    defensePenetration: number;
    imageKey: string;
    activeSkillText: string;
    chargeSkillText: string;
    firstPassiveSkillText: string;
    secondPassiveSkillText: string;
    definitionId: string;
}

interface AddShipTemplateFormProps {
    onSubmit: (data: ShipTemplateFormData) => Promise<void>;
    loading: boolean;
}

const AFFINITY_OPTIONS = [
    { value: 'chemical', label: 'Chemical' },
    { value: 'electric', label: 'Electric' },
    { value: 'thermal', label: 'Thermal' },
    { value: 'antimatter', label: 'Antimatter' },
];

export const AddShipTemplateForm: React.FC<AddShipTemplateFormProps> = ({ onSubmit, loading }) => {
    const [formData, setFormData] = useState<ShipTemplateFormData>({
        name: '',
        affinity: 'chemical',
        rarity: 'common',
        faction: 'Atlas Syndicate',
        type: 'Attacker',
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        critRate: 0,
        critDamage: 0,
        speed: 0,
        hpRegen: 0,
        shield: 0,
        shieldPenetration: 0,
        defensePenetration: 0,
        imageKey: '',
        activeSkillText: '',
        chargeSkillText: '',
        firstPassiveSkillText: '',
        secondPassiveSkillText: '',
        definitionId: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(formData);
        // Reset form
        setFormData({
            name: '',
            affinity: 'chemical',
            rarity: 'common',
            faction: 'Atlas Syndicate',
            type: 'Attacker',
            hp: 0,
            attack: 0,
            defence: 0,
            hacking: 0,
            security: 0,
            critRate: 0,
            critDamage: 0,
            speed: 0,
            hpRegen: 0,
            shield: 0,
            shieldPenetration: 0,
            defensePenetration: 0,
            imageKey: '',
            activeSkillText: '',
            chargeSkillText: '',
            firstPassiveSkillText: '',
            secondPassiveSkillText: '',
            definitionId: '',
        });
    };

    const updateField = (field: keyof ShipTemplateFormData, value: string | number) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const factionOptions = Object.values(FACTIONS).map((f) => ({
        value: f.name,
        label: f.name,
    }));

    const rarityOptions = Object.values(RARITIES).map((r) => ({
        value: r.value,
        label: r.label,
    }));

    const typeOptions = Object.values(SHIP_TYPES).map((t) => ({
        value: t.name,
        label: t.name,
    }));

    return (
        <form onSubmit={handleSubmit} className="bg-dark-lighter p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Add New Ship Template</h3>

            <div className="space-y-4">
                {/* Basic Info Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Ship Name *
                        </label>
                        <Input
                            type="text"
                            value={formData.name}
                            onChange={(e) => updateField('name', e.target.value)}
                            required
                            placeholder="e.g., Vanguard"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Rarity *
                        </label>
                        <Select
                            value={formData.rarity}
                            onChange={(value) => updateField('rarity', value)}
                            options={rarityOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Faction *
                        </label>
                        <Select
                            value={formData.faction}
                            onChange={(value) => updateField('faction', value)}
                            options={factionOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Type (Role) *
                        </label>
                        <Select
                            value={formData.type}
                            onChange={(value) => updateField('type', value)}
                            options={typeOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Affinity *
                        </label>
                        <Select
                            value={formData.affinity}
                            onChange={(value) => updateField('affinity', value as AffinityName)}
                            options={AFFINITY_OPTIONS}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Image Key
                        </label>
                        <Input
                            type="text"
                            value={formData.imageKey}
                            onChange={(e) => updateField('imageKey', e.target.value)}
                            placeholder="e.g., ship_vanguard"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Definition ID
                        </label>
                        <Input
                            type="text"
                            value={formData.definitionId}
                            onChange={(e) => updateField('definitionId', e.target.value)}
                            placeholder="e.g., Legion_Attacker_Rare_1"
                        />
                    </div>
                </div>

                {/* Stats Section */}
                <div>
                    <h4 className="text-lg font-semibold mb-3 text-primary">Base Stats</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                HP *
                            </label>
                            <Input
                                type="number"
                                value={formData.hp}
                                onChange={(e) => updateField('hp', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Attack *
                            </label>
                            <Input
                                type="number"
                                value={formData.attack}
                                onChange={(e) => updateField('attack', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Defence *
                            </label>
                            <Input
                                type="number"
                                value={formData.defence}
                                onChange={(e) => updateField('defence', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Hacking *
                            </label>
                            <Input
                                type="number"
                                value={formData.hacking}
                                onChange={(e) => updateField('hacking', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Security *
                            </label>
                            <Input
                                type="number"
                                value={formData.security}
                                onChange={(e) => updateField('security', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Crit Rate (%) *
                            </label>
                            <Input
                                type="number"
                                value={formData.critRate}
                                onChange={(e) => updateField('critRate', Number(e.target.value))}
                                required
                                min={0}
                                step={0.01}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Crit Damage (%) *
                            </label>
                            <Input
                                type="number"
                                value={formData.critDamage}
                                onChange={(e) => updateField('critDamage', Number(e.target.value))}
                                required
                                min={0}
                                step={0.01}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Speed *
                            </label>
                            <Input
                                type="number"
                                value={formData.speed}
                                onChange={(e) => updateField('speed', Number(e.target.value))}
                                required
                                min={0}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                HP Regen (%)
                            </label>
                            <Input
                                type="number"
                                value={formData.hpRegen}
                                onChange={(e) => updateField('hpRegen', Number(e.target.value))}
                                min={0}
                                step={0.01}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Shield (%)
                            </label>
                            <Input
                                type="number"
                                value={formData.shield}
                                onChange={(e) => updateField('shield', Number(e.target.value))}
                                min={0}
                                step={0.01}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Shield Penetration (%)
                            </label>
                            <Input
                                type="number"
                                value={formData.shieldPenetration}
                                onChange={(e) =>
                                    updateField('shieldPenetration', Number(e.target.value))
                                }
                                min={0}
                                step={0.01}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Defense Penetration (%)
                            </label>
                            <Input
                                type="number"
                                value={formData.defensePenetration}
                                onChange={(e) =>
                                    updateField('defensePenetration', Number(e.target.value))
                                }
                                min={0}
                                step={0.01}
                            />
                        </div>
                    </div>
                </div>

                {/* Skills Section */}
                <div>
                    <h4 className="text-lg font-semibold mb-3 text-primary">Skills</h4>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Active Skill
                            </label>
                            <textarea
                                className="w-full bg-dark border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={3}
                                value={formData.activeSkillText}
                                onChange={(e) => updateField('activeSkillText', e.target.value)}
                                placeholder="Describe the active skill..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Charge Skill
                            </label>
                            <textarea
                                className="w-full bg-dark border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={3}
                                value={formData.chargeSkillText}
                                onChange={(e) => updateField('chargeSkillText', e.target.value)}
                                placeholder="Describe the charge skill..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                First Passive Skill
                            </label>
                            <textarea
                                className="w-full bg-dark border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={3}
                                value={formData.firstPassiveSkillText}
                                onChange={(e) =>
                                    updateField('firstPassiveSkillText', e.target.value)
                                }
                                placeholder="Describe the first passive skill..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                                Second Passive Skill
                            </label>
                            <textarea
                                className="w-full bg-dark border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={3}
                                value={formData.secondPassiveSkillText}
                                onChange={(e) =>
                                    updateField('secondPassiveSkillText', e.target.value)
                                }
                                placeholder="Describe the second passive skill..."
                            />
                        </div>
                    </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                    <Button type="submit" variant="primary" disabled={loading}>
                        {loading ? 'Adding Ship...' : 'Add Ship Template'}
                    </Button>
                </div>
            </div>
        </form>
    );
};
