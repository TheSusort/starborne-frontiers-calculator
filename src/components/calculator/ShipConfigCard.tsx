import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import {
    DPSShipConfig,
    DPSShipConfigUpdateableField,
    DoTApplicationEntry,
} from '../../types/calculator';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { ShipSelector } from '../ship/ShipSelector';
import { SkillTooltip } from '../ship/SkillTooltip';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { DoTEditor } from './DoTEditor';
import { ShipConfigSummary } from './ShipConfigSummary';

interface AttackerBuffTotals {
    attackBuff: number;
    critBuff: number;
    critDamageBuff: number;
}

interface ShipConfigCardProps {
    config: DPSShipConfig;
    isBest: boolean;
    isComparing: boolean;
    simResult: DPSSimulationResult | undefined;
    bestTotalDamage: number | undefined;
    bestVsSecondPercentage: number | null;
    rounds: number;
    attackerBuffTotals: AttackerBuffTotals;
    onRemove: () => void;
    onUpdate: (field: DPSShipConfigUpdateableField, value: string | number) => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onAddDoT: (dotField: 'activeDoTs' | 'chargedDoTs') => void;
    onRemoveDoT: (dotField: 'activeDoTs' | 'chargedDoTs', dotId: string) => void;
    onUpdateDoT: (
        dotField: 'activeDoTs' | 'chargedDoTs',
        dotId: string,
        updates: Partial<DoTApplicationEntry>
    ) => void;
}

export const ShipConfigCard: React.FC<ShipConfigCardProps> = ({
    config,
    isBest,
    isComparing,
    simResult,
    bestTotalDamage,
    bestVsSecondPercentage,
    rounds,
    attackerBuffTotals,
    onRemove,
    onUpdate,
    onSelectShip,
    onStartChargedChange,
    onAddDoT,
    onRemoveDoT,
    onUpdateDoT,
}) => {
    const [openAdvanced, setOpenAdvanced] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;

    return (
        <div className={`p-4 bg-dark border ${isBest ? 'border-primary' : 'border-dark-border'}`}>
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
                <div className="flex gap-4">
                    <Input
                        label="Attack"
                        type="number"
                        value={config.attack}
                        onChange={(e) => onUpdate('attack', parseInt(e.target.value) || 0)}
                    />
                </div>
                <div className="flex gap-4">
                    <Input
                        label="Crit Rate (%)"
                        type="number"
                        min="0"
                        max="100"
                        value={config.crit}
                        onChange={(e) => onUpdate('crit', parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Crit Damage (%)"
                        type="number"
                        min="0"
                        value={config.critDamage}
                        onChange={(e) => onUpdate('critDamage', parseInt(e.target.value) || 0)}
                    />
                </div>
                <div className="flex gap-4">
                    <Input
                        label="Defense Penetration (%)"
                        type="number"
                        min="0"
                        max="100"
                        value={config.defensePenetration}
                        onChange={(e) =>
                            onUpdate('defensePenetration', parseInt(e.target.value) || 0)
                        }
                    />
                </div>

                <Button
                    variant="link"
                    onClick={() => setOpenAdvanced((v) => !v)}
                    className="w-full flex justify-between items-center mt-4"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDownIcon
                            className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${openAdvanced ? 'rotate-180' : ''}`}
                        />
                        {openAdvanced ? 'Hide' : 'Show'} Advanced
                    </span>
                </Button>

                <CollapsibleForm isVisible={openAdvanced}>
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                        Skills
                    </div>
                    <div className="grid grid-cols-4 lg:grid-cols-2 gap-4 mb-4 items-end">
                        <Input
                            label="Active (%)"
                            type="number"
                            min="0"
                            value={config.activeMultiplier}
                            helpLabel={
                                config.autoFilledFields?.has('activeMultiplier')
                                    ? 'auto-filled'
                                    : undefined
                            }
                            onChange={(e) =>
                                onUpdate('activeMultiplier', parseInt(e.target.value) || 0)
                            }
                        />
                        <Input
                            label="Charged (%)"
                            type="number"
                            min="0"
                            value={config.chargedMultiplier}
                            helpLabel={
                                config.autoFilledFields?.has('chargedMultiplier')
                                    ? 'auto-filled'
                                    : undefined
                            }
                            onChange={(e) =>
                                onUpdate('chargedMultiplier', parseInt(e.target.value) || 0)
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
                                <div className="space-y-3 pt-2 pb-4 border-b border-dark-border mb-4">
                                    {selectedShip.activeSkillText && (
                                        <SkillTooltip
                                            inline
                                            skillText={selectedShip.activeSkillText}
                                            skillType="Active"
                                        />
                                    )}
                                    {selectedShip.chargeSkillText && (
                                        <SkillTooltip
                                            inline
                                            skillText={selectedShip.chargeSkillText}
                                            skillType="Charge"
                                            charge={selectedShip.chargeSkillCharge}
                                        />
                                    )}
                                    {(() => {
                                        const refitCount = selectedShip.refits.length;
                                        if (refitCount >= 4 && selectedShip.thirdPassiveSkillText)
                                            return (
                                                <SkillTooltip
                                                    inline
                                                    skillText={selectedShip.thirdPassiveSkillText}
                                                    skillType="Passive R4"
                                                />
                                            );
                                        if (refitCount >= 2 && selectedShip.secondPassiveSkillText)
                                            return (
                                                <SkillTooltip
                                                    inline
                                                    skillText={selectedShip.secondPassiveSkillText}
                                                    skillType="Passive R2"
                                                />
                                            );
                                        if (refitCount >= 1 && selectedShip.firstPassiveSkillText)
                                            return (
                                                <SkillTooltip
                                                    inline
                                                    skillText={selectedShip.firstPassiveSkillText}
                                                    skillType="Passive R1"
                                                />
                                            );
                                        return null;
                                    })()}
                                </div>
                            </CollapsibleForm>
                        </>
                    )}

                    <DoTEditor
                        dots={config.activeDoTs}
                        label="DoTs — Active Skill"
                        labelClassName="text-orange-400"
                        onAdd={() => onAddDoT('activeDoTs')}
                        onRemove={(dotId) => onRemoveDoT('activeDoTs', dotId)}
                        onUpdate={(dotId, updates) => onUpdateDoT('activeDoTs', dotId, updates)}
                    />
                    <DoTEditor
                        dots={config.chargedDoTs}
                        label="DoTs — Charged Skill"
                        labelClassName="text-purple-400"
                        onAdd={() => onAddDoT('chargedDoTs')}
                        onRemove={(dotId) => onRemoveDoT('chargedDoTs', dotId)}
                        onUpdate={(dotId, updates) => onUpdateDoT('chargedDoTs', dotId, updates)}
                    />
                </CollapsibleForm>

                {simResult && (
                    <ShipConfigSummary
                        config={config}
                        simResult={simResult}
                        isBest={isBest}
                        isComparing={isComparing}
                        rounds={rounds}
                        attackerBuffTotals={attackerBuffTotals}
                        bestTotalDamage={bestTotalDamage}
                        bestVsSecondPercentage={bestVsSecondPercentage}
                    />
                )}
            </div>
        </div>
    );
};
