import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { FACTIONS } from '../../constants/factions';
import { RARITIES } from '../../constants/rarities';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { AffinityName } from '../../types/ship';
import { TARGET_VALUES, parsePattern } from '../../utils/targetingParser';

export interface ShipTemplateFormData {
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
    chargeSkillCharge: number;
    firstPassiveSkillText: string;
    secondPassiveSkillText: string;
    thirdPassiveSkillText: string;
    activeTarget: string;
    activePattern: string;
    chargedTarget: string;
    chargedPattern: string;
    definitionId: string;
}

interface AddShipTemplateFormProps {
    onSubmit: (data: ShipTemplateFormData) => Promise<void>;
    loading: boolean;
    mode?: 'add' | 'edit';
    initialData?: ShipTemplateFormData | null;
}

const AFFINITY_OPTIONS = [
    { value: 'chemical', label: 'Chemical' },
    { value: 'electric', label: 'Electric' },
    { value: 'thermal', label: 'Thermal' },
    { value: 'antimatter', label: 'Antimatter' },
];

// Targeting options come from the parser's own vocabulary: `parseTarget` throws on
// anything outside it, so a hand-written list here would drift into unparseable data.
const ACTIVE_TARGET_OPTIONS = [
    { value: '', label: '— not set —' },
    ...TARGET_VALUES.map((v) => ({ value: v, label: v })),
];

// An empty charged column means "this axis is the same as active" (parseShipTargeting
// merges per-column), so empty is a meaningful value here, not a missing one.
const CHARGED_TARGET_OPTIONS = [
    { value: '', label: '— same as active —' },
    ...TARGET_VALUES.map((v) => ({ value: v, label: v })),
];

/** Live feedback for the free-text pattern inputs: patterns are compositional
 *  (`Pattern-Cone-Range-2-Support`), so they cannot be enumerated in a Select and are
 *  instead checked against the parser as they are typed. */
const describePattern = (raw: string): { error?: string; summary?: string } => {
    if (!raw.trim()) return {};
    try {
        const parsed = parsePattern(raw);
        const mods = Object.entries(parsed.modifiers)
            .filter(([, v]) => v)
            .map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`));
        const parts = [`shape: ${parsed.shape}`, `range: ${String(parsed.range)}`];
        if (mods.length > 0) parts.push(`modifiers: ${mods.join(', ')}`);
        return { summary: parts.join(' · ') };
    } catch (e) {
        return { error: e instanceof Error ? e.message : 'Unparseable pattern' };
    }
};

const DEFAULT_FORM_DATA: ShipTemplateFormData = {
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
    chargeSkillCharge: 0,
    firstPassiveSkillText: '',
    secondPassiveSkillText: '',
    thirdPassiveSkillText: '',
    activeTarget: '',
    activePattern: '',
    chargedTarget: '',
    chargedPattern: '',
    definitionId: '',
};

export const AddShipTemplateForm: React.FC<AddShipTemplateFormProps> = ({
    onSubmit,
    loading,
    mode = 'add',
    initialData,
}) => {
    const [formData, setFormData] = useState<ShipTemplateFormData>(
        initialData || DEFAULT_FORM_DATA
    );

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData(DEFAULT_FORM_DATA);
        }
    }, [initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(formData);
        if (mode === 'add') {
            setFormData(DEFAULT_FORM_DATA);
        }
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

    const activePatternFeedback = describePattern(formData.activePattern);
    const chargedPatternFeedback = describePattern(formData.chargedPattern);
    // parseShipTargeting needs BOTH active columns to produce any targeting at all, so
    // filling one alone leaves the ship untargeted rather than half-targeted.
    const activeAxisIncomplete =
        Boolean(formData.activeTarget) !== Boolean(formData.activePattern.trim());
    // A stored pattern the parser rejects makes parseShipTargeting throw wherever the sim
    // reads this ship, so it must never reach the database.
    const hasPatternError = Boolean(activePatternFeedback.error || chargedPatternFeedback.error);

    return (
        <form onSubmit={(e) => void handleSubmit(e)} className="card">
            <h3 className="text-xl font-semibold mb-4">
                {mode === 'edit' ? 'Edit Ship Template' : 'Add New Ship Template'}
            </h3>

            <div className="space-y-4">
                {/* Basic Info Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">
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
                        <label className="block text-sm font-medium text-theme-text mb-1">
                            Rarity *
                        </label>
                        <Select
                            value={formData.rarity}
                            onChange={(value) => updateField('rarity', value)}
                            options={rarityOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">
                            Faction *
                        </label>
                        <Select
                            value={formData.faction}
                            onChange={(value) => updateField('faction', value)}
                            options={factionOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">
                            Type (Role) *
                        </label>
                        <Select
                            value={formData.type}
                            onChange={(value) => updateField('type', value)}
                            options={typeOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">
                            Affinity *
                        </label>
                        <Select
                            value={formData.affinity}
                            onChange={(value) => updateField('affinity', value)}
                            options={AFFINITY_OPTIONS}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-theme-text mb-1">
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
                        <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <label className="block text-sm font-medium text-theme-text mb-1">
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
                            <Textarea
                                label="Active Skill"
                                rows={3}
                                value={formData.activeSkillText}
                                onChange={(e) => updateField('activeSkillText', e.target.value)}
                                placeholder="Describe the active skill..."
                            />
                        </div>

                        <div>
                            <Textarea
                                label="Charge Skill"
                                rows={3}
                                value={formData.chargeSkillText}
                                onChange={(e) => updateField('chargeSkillText', e.target.value)}
                                placeholder="Describe the charge skill..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-theme-text mb-1">
                                Charge Skill Charge
                            </label>
                            <Input
                                type="number"
                                value={formData.chargeSkillCharge}
                                onChange={(e) =>
                                    updateField('chargeSkillCharge', Number(e.target.value))
                                }
                                min={0}
                            />
                        </div>

                        <div>
                            <Textarea
                                label="First Passive Skill"
                                rows={3}
                                value={formData.firstPassiveSkillText}
                                onChange={(e) =>
                                    updateField('firstPassiveSkillText', e.target.value)
                                }
                                placeholder="Describe the first passive skill..."
                            />
                        </div>

                        <div>
                            <Textarea
                                label="Second Passive Skill"
                                rows={3}
                                value={formData.secondPassiveSkillText}
                                onChange={(e) =>
                                    updateField('secondPassiveSkillText', e.target.value)
                                }
                                placeholder="Describe the second passive skill..."
                            />
                        </div>

                        <div>
                            <Textarea
                                label="Third Passive Skill"
                                rows={3}
                                value={formData.thirdPassiveSkillText}
                                onChange={(e) =>
                                    updateField('thirdPassiveSkillText', e.target.value)
                                }
                                placeholder="Describe the third passive skill..."
                            />
                        </div>
                    </div>
                </div>

                {/* Targeting Section */}
                <div>
                    <h4 className="text-lg font-semibold mb-3 text-primary">Targeting</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Select
                                label="Active Target"
                                value={formData.activeTarget}
                                onChange={(value) => updateField('activeTarget', value)}
                                options={ACTIVE_TARGET_OPTIONS}
                            />
                        </div>

                        <div>
                            <Input
                                type="text"
                                label="Active Pattern"
                                value={formData.activePattern}
                                onChange={(e) => updateField('activePattern', e.target.value)}
                                placeholder="e.g., Pattern-Cone-Range-2"
                                error={activePatternFeedback.error}
                                hint={activePatternFeedback.summary}
                            />
                        </div>

                        <div>
                            <Select
                                label="Charged Target"
                                value={formData.chargedTarget}
                                onChange={(value) => updateField('chargedTarget', value)}
                                options={CHARGED_TARGET_OPTIONS}
                            />
                        </div>

                        <div>
                            <Input
                                type="text"
                                label="Charged Pattern"
                                value={formData.chargedPattern}
                                onChange={(e) => updateField('chargedPattern', e.target.value)}
                                placeholder="Leave empty to match the active pattern"
                                error={chargedPatternFeedback.error}
                                hint={chargedPatternFeedback.summary}
                            />
                        </div>
                    </div>
                    {activeAxisIncomplete && (
                        <p className="text-sm text-yellow-500 mt-2">
                            Active Target and Active Pattern are only used together — with one of
                            them empty this ship gets no targeting at all.
                        </p>
                    )}
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                    <Button type="submit" variant="primary" disabled={loading || hasPatternError}>
                        {loading
                            ? mode === 'edit'
                                ? 'Updating...'
                                : 'Adding Ship...'
                            : mode === 'edit'
                              ? 'Update Template'
                              : 'Add Ship Template'}
                    </Button>
                </div>
            </div>
        </form>
    );
};
