import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { DefenseShipConfig, DefenseBuffTotals, SelectedGameBuff } from '../../types/calculator';
import { computeBuffedStats } from '../../utils/calculators/defenseCalculator';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { ShipSkillList } from '../ship/ShipSkillList';
import { GameBuffPicker } from './GameBuffPicker';

interface DefenseShipCardProps {
    config: DefenseShipConfig;
    isBest: boolean;
    isComparing: boolean;
    bestEffectiveHP?: number;
    buffTotals?: DefenseBuffTotals;
    onRemove: () => void;
    onUpdate: (field: 'name' | 'hp' | 'defense' | 'security', value: string | number) => void;
    onSelectShip: (ship: Ship) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
}

export const DefenseShipCard: React.FC<DefenseShipCardProps> = ({
    config,
    isBest,
    isComparing,
    bestEffectiveHP,
    buffTotals,
    onRemove,
    onUpdate,
    onSelectShip,
    onBuffsChange,
}) => {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;

    const hasBuffs =
        (buffTotals?.defenseBuff ?? 0) !== 0 ||
        (buffTotals?.incomingDamageBuff ?? 0) !== 0 ||
        (buffTotals?.securityBuff ?? 0) !== 0;
    const { buffedDefense, damageReduction, effectiveHP, buffedSecurity } = computeBuffedStats(
        config.hp,
        config.defense,
        config.security,
        buffTotals
    );

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
                <Button variant="danger" onClick={onRemove} aria-label="Remove ship">
                    <CloseIcon />
                </Button>
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                    <Input
                        label="HP"
                        type="number"
                        value={config.hp}
                        onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Defense"
                        type="number"
                        value={config.defense}
                        onChange={(e) => onUpdate('defense', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Security"
                        type="number"
                        value={config.security}
                        onChange={(e) => onUpdate('security', parseInt(e.target.value) || 0)}
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
                        Ship Buffs
                    </div>
                    <GameBuffPicker
                        label="Ship Buffs"
                        relevantStats={['defense', 'incomingDamage', 'security']}
                        excludeTypes={['effect']}
                        value={config.buffs}
                        onChange={onBuffsChange}
                        noEffectLabel="No defensive effect"
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

                <div className="mt-4 pt-4 border-t border-dark-border">
                    <div className="flex justify-between mb-2">
                        <span className="text-theme-text-secondary">Damage Reduction:</span>
                        <span>{damageReduction.toFixed(2)}%</span>
                    </div>
                    {hasBuffs && (
                        <div className="flex justify-between mb-2 text-sm">
                            <span className="text-theme-text-secondary">Buffed Defense:</span>
                            <span>{Math.round(buffedDefense).toLocaleString()}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-theme-text-secondary">Effective HP:</span>
                        <span className={isBest ? 'text-primary font-bold' : ''}>
                            {Math.round(effectiveHP).toLocaleString()}
                        </span>
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className="text-theme-text-secondary">HP Multiplier:</span>
                        <span>{(effectiveHP / config.hp).toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className="text-theme-text-secondary">Security:</span>
                        <span
                            className={
                                hasBuffs && (buffTotals?.securityBuff ?? 0) !== 0
                                    ? 'text-yellow-400'
                                    : ''
                            }
                        >
                            {Math.round(buffedSecurity).toLocaleString()}
                        </span>
                    </div>
                    {isComparing && !isBest && bestEffectiveHP && (
                        <div className="flex justify-between mt-2">
                            <span className="text-theme-text-secondary">Compared to best:</span>
                            <span className="text-red-500">
                                {(
                                    ((effectiveHP - bestEffectiveHP) / bestEffectiveHP) *
                                    100
                                ).toFixed(2)}
                                %
                            </span>
                        </div>
                    )}
                </div>

                {isBest && (
                    <div className="text-primary text-sm mt-2 text-center">
                        Best ship configuration
                    </div>
                )}
            </div>
        </div>
    );
};
