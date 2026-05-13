import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import {
    HealerConfig,
    HealerConfigUpdateableField,
    HealingBuffTotals,
    SelectedGameBuff,
} from '../../types/calculator';
import { calculateHealing } from '../../utils/calculators/healingCalculator';
import { ShipSelector } from '../ship/ShipSelector';
import { ShipSkillList } from '../ship/ShipSkillList';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { GameBuffPicker } from './GameBuffPicker';

const HEAL_MODIFIER_OPTIONS = [
    { value: '0', label: '0%' },
    { value: '10', label: '10%' },
    { value: '20', label: '20%' },
    { value: '30', label: '30%' },
    { value: '40', label: '40%' },
    { value: '50', label: '50%' },
    { value: '60', label: '60%' },
];

interface HealerConfigCardProps {
    config: HealerConfig;
    isBest: boolean;
    isComparing: boolean;
    bestEffectiveHealing: number | undefined;
    buffTotals?: HealingBuffTotals;
    onRemove: () => void;
    onUpdate: (field: HealerConfigUpdateableField, value: string | number) => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
}

export const HealerConfigCard: React.FC<HealerConfigCardProps> = ({
    config,
    isBest,
    isComparing,
    bestEffectiveHealing,
    buffTotals,
    onRemove,
    onUpdate,
    onSelectShip,
    onStartChargedChange,
    onBuffsChange,
}) => {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;
    const result = calculateHealing(config, buffTotals);
    const hasCharged = config.chargedHealPercent > 0 && config.chargeCount > 0;

    return (
        <div className={`card relative ${isBest ? 'border-primary' : ''}`}>
            <div className="mb-4">
                <ShipSelector
                    selected={selectedShip ?? null}
                    onSelect={onSelectShip}
                    variant="compact"
                />
            </div>
            <div className="flex justify-between items-center mb-4">
                <Input
                    value={config.name}
                    onChange={(e) => onUpdate('name', e.target.value)}
                    className="font-bold"
                />
                <Button variant="danger" onClick={onRemove} aria-label="Remove healer">
                    <CloseIcon />
                </Button>
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="HP"
                        type="number"
                        value={config.hp}
                        onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Crit Chance (%)"
                        type="number"
                        min="0"
                        max="100"
                        value={config.crit}
                        onChange={(e) => onUpdate('crit', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Crit Power (%)"
                        type="number"
                        min="0"
                        max="200"
                        value={config.critDamage}
                        onChange={(e) => onUpdate('critDamage', parseInt(e.target.value) || 0)}
                    />
                    <Select
                        label="Heal Modifier (%)"
                        className="w-fit"
                        value={config.healModifier.toString()}
                        options={HEAL_MODIFIER_OPTIONS}
                        onChange={(value) => onUpdate('healModifier', parseInt(value) || 0)}
                    />
                </div>

                <Button
                    variant="link"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="w-full flex justify-between items-center mt-4"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDownIcon
                            className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${advancedOpen ? 'rotate-180' : ''}`}
                        />
                        {advancedOpen ? 'Hide' : 'Show'} Advanced
                    </span>
                </Button>

                <CollapsibleForm isVisible={advancedOpen}>
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                        Skills
                    </div>
                    <div className="grid grid-cols-4 lg:grid-cols-2 gap-4 mb-4 items-end">
                        <Input
                            label="Active (%)"
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={config.healPercent}
                            helpLabel={config.healPercentAutoFilled ? 'auto-filled' : undefined}
                            onChange={(e) =>
                                onUpdate('healPercent', parseFloat(e.target.value) || 0)
                            }
                        />
                        <Input
                            label="Charged (%)"
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={config.chargedHealPercent}
                            helpLabel={
                                config.chargedHealPercentAutoFilled ? 'auto-filled' : undefined
                            }
                            onChange={(e) =>
                                onUpdate('chargedHealPercent', parseFloat(e.target.value) || 0)
                            }
                        />
                        <Input
                            label="Charge Count"
                            type="number"
                            min="0"
                            value={config.chargeCount}
                            onChange={(e) => onUpdate('chargeCount', parseInt(e.target.value) || 0)}
                        />
                        <div>
                            <Checkbox
                                id={`start-charged-${config.id}`}
                                label="Start Charged"
                                checked={config.startCharged}
                                onChange={onStartChargedChange}
                            />
                        </div>
                    </div>

                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 mt-4">
                        Ship Buffs
                    </div>
                    <GameBuffPicker
                        label="Ship Buffs"
                        relevantStats={['crit', 'critDamage']}
                        excludeTypes={['effect']}
                        value={config.buffs}
                        onChange={onBuffsChange}
                    />

                    {selectedShip && (
                        <>
                            <Button
                                variant="link"
                                onClick={() => setSkillRefOpen((v) => !v)}
                                className="w-full flex justify-between items-center mt-4 border-b border-dark-border pb-4 mb-4"
                            >
                                <span className="flex items-center gap-2">
                                    <ChevronDownIcon
                                        className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${skillRefOpen ? 'rotate-180' : ''}`}
                                    />
                                    Skill Reference
                                </span>
                            </Button>
                            <CollapsibleForm isVisible={skillRefOpen}>
                                <div className="pt-2 pb-4 border-b border-dark-border mb-4">
                                    <ShipSkillList ship={selectedShip} />
                                </div>
                            </CollapsibleForm>
                        </>
                    )}
                </CollapsibleForm>

                <div className="mt-4 pt-4 border-t border-dark-border space-y-2">
                    <div className="flex justify-between">
                        <span className="text-theme-text-secondary">Active Heal:</span>
                        <span>{Math.round(result.activeEffectiveHealing).toLocaleString()} HP</span>
                    </div>
                    {hasCharged && (
                        <div className="flex justify-between">
                            <span className="text-theme-text-secondary">Charged Heal:</span>
                            <span>
                                {Math.round(result.chargedEffectiveHealing).toLocaleString()} HP
                            </span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-theme-text-secondary">
                            {hasCharged ? 'Avg per Round:' : 'Effective Healing:'}
                        </span>
                        <span className={isBest ? 'text-primary font-bold' : ''}>
                            {Math.round(result.effectiveHealing).toLocaleString()} HP
                        </span>
                    </div>
                    {isComparing && !isBest && bestEffectiveHealing && (
                        <div className="flex justify-between">
                            <span className="text-theme-text-secondary">Compared to best:</span>
                            <span className="text-red-500">
                                {(
                                    ((result.effectiveHealing - bestEffectiveHealing) /
                                        bestEffectiveHealing) *
                                    100
                                ).toFixed(2)}
                                %
                            </span>
                        </div>
                    )}
                </div>

                {isBest && (
                    <div className="text-primary text-sm mt-2 text-center">
                        Best healer configuration
                    </div>
                )}
            </div>
        </div>
    );
};
