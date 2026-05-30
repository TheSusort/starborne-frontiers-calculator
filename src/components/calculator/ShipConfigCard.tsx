import React, { useState, useEffect } from 'react';
import { Ship, AffinityName } from '../../types/ship';
import { Select } from '../ui/Select';
import { getAffinityMatchup } from '../../utils/calculators/affinityUtils';
import {
    DPSShipConfig,
    DPSShipConfigUpdateableField,
    DoTApplicationEntry,
    AttackerBuffTotals,
    SelectedGameBuff,
    SecondaryDamage,
    ConditionalDamage,
    CONDITIONAL_CONDITION_LABELS,
} from '../../types/calculator';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { ShipSelector } from '../ship/ShipSelector';
import { ShipSkillList } from '../ship/ShipSkillList';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { DoTEditor } from './DoTEditor';
import { GameBuffPicker } from './GameBuffPicker';
import { ShipConfigSummary } from './ShipConfigSummary';

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
    onUpdate: (field: DPSShipConfigUpdateableField, value: string | number | undefined) => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onAddDoT: (dotField: 'activeDoTs' | 'chargedDoTs') => void;
    onRemoveDoT: (dotField: 'activeDoTs' | 'chargedDoTs', dotId: string) => void;
    onUpdateDoT: (
        dotField: 'activeDoTs' | 'chargedDoTs',
        dotId: string,
        updates: Partial<DoTApplicationEntry>
    ) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
    onEnemyDebuffsChange: (debuffs: SelectedGameBuff[]) => void;
    onSecondaryChange: (
        field: 'activeSecondary' | 'chargedSecondary',
        value: SecondaryDamage | undefined
    ) => void;
    onConditionalChange: (
        field: 'activeConditional' | 'chargedConditional',
        value: ConditionalDamage | undefined
    ) => void;
    enemyAffinity: AffinityName;
    enemySecurity: number;
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
    onBuffsChange,
    onEnemyDebuffsChange,
    onSecondaryChange,
    onConditionalChange,
    enemyAffinity,
    enemySecurity,
}) => {
    const [openAdvanced, setOpenAdvanced] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const [openSecondary, setOpenSecondary] = useState(
        Boolean(config.activeSecondary || config.chargedSecondary)
    );
    const [openConditional, setOpenConditional] = useState(
        Boolean(config.activeConditional || config.chargedConditional)
    );
    // Re-sync the collapsible sections when parsed values change (e.g. after
    // selectShipForConfig auto-fills a newly selected ship) so freshly detected
    // secondary/conditional data is revealed rather than hidden in a closed section.
    useEffect(() => {
        setOpenSecondary(Boolean(config.activeSecondary || config.chargedSecondary));
        setOpenConditional(Boolean(config.activeConditional || config.chargedConditional));
    }, [
        config.activeSecondary,
        config.chargedSecondary,
        config.activeConditional,
        config.chargedConditional,
    ]);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;

    const affinityMatchup = getAffinityMatchup(config.affinity, enemyAffinity);
    const affinityBadge =
        affinityMatchup === 'advantage' ? (
            <span className="text-sm text-green-400 ml-2">Advantage</span>
        ) : affinityMatchup === 'disadvantage' ? (
            <span className="text-sm text-red-400 ml-2">Disadvantage</span>
        ) : null;

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
                    <div className="flex items-center gap-2 mb-4 relative">
                        <Select
                            label="Affinity"
                            value={config.affinity ?? 'antimatter'}
                            onChange={(v) =>
                                onUpdate('affinity', v === '' ? undefined : (v as AffinityName))
                            }
                            options={[
                                { value: 'antimatter', label: 'Antimatter' },
                                { value: 'thermal', label: 'Thermal' },
                                { value: 'chemical', label: 'Chemical' },
                                { value: 'electric', label: 'Electric' },
                            ]}
                            className="flex-1"
                        />
                        <div className="absolute left-[43px] top-[-2px]">{affinityBadge}</div>
                    </div>

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

                    <div className="mb-4">
                        <Input
                            label="Hacking"
                            type="number"
                            min="0"
                            value={config.hacking ?? 200}
                            helpLabel={
                                config.autoFilledFields?.has('hacking') ? 'auto-filled' : undefined
                            }
                            onChange={(e) => onUpdate('hacking', parseInt(e.target.value) || 0)}
                        />
                        <p className="text-xs text-theme-text-secondary mt-1">
                            Landing:{' '}
                            {Math.min(100, Math.max(0, (config.hacking ?? 200) - enemySecurity))}%
                            vs enemy
                        </p>
                    </div>

                    <Button
                        variant="link"
                        onClick={() => setOpenSecondary((v) => !v)}
                        className="w-full flex justify-between items-center mt-4"
                    >
                        <span className="flex items-center gap-2">
                            <ChevronDownIcon
                                className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${openSecondary ? 'rotate-180' : ''}`}
                            />
                            Secondary Damage
                        </span>
                    </Button>
                    <CollapsibleForm isVisible={openSecondary}>
                        <div className="flex gap-4 mb-4">
                            <Input
                                label="Defense (source)"
                                type="number"
                                min="0"
                                value={config.defence}
                                onChange={(e) => onUpdate('defence', parseInt(e.target.value) || 0)}
                            />
                            <Input
                                label="HP (source)"
                                type="number"
                                min="0"
                                value={config.hp}
                                onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                            />
                        </div>
                        <div className="flex gap-4 mb-4 items-end">
                            <Select
                                label="Active Secondary Stat"
                                value={config.activeSecondary?.stat ?? ''}
                                onChange={(v) =>
                                    v === ''
                                        ? onSecondaryChange('activeSecondary', undefined)
                                        : onSecondaryChange('activeSecondary', {
                                              stat: v as 'defense' | 'hp',
                                              pct: config.activeSecondary?.pct ?? 0,
                                          })
                                }
                                helpLabel={
                                    config.autoFilledFields?.has('activeSecondary')
                                        ? 'auto-filled'
                                        : undefined
                                }
                                options={[
                                    { value: '', label: 'None' },
                                    { value: 'defense', label: 'Defense' },
                                    { value: 'hp', label: 'Max HP' },
                                ]}
                                className="flex-1"
                            />
                            <Input
                                label="Active %"
                                type="number"
                                min="0"
                                value={config.activeSecondary?.pct ?? 0}
                                disabled={!config.activeSecondary}
                                onChange={(e) =>
                                    onSecondaryChange('activeSecondary', {
                                        stat: config.activeSecondary?.stat ?? 'defense',
                                        pct: parseFloat(e.target.value) || 0,
                                    })
                                }
                            />
                        </div>
                        <div className="flex gap-4 mb-4 items-end">
                            <Select
                                label="Charged Secondary Stat"
                                value={config.chargedSecondary?.stat ?? ''}
                                onChange={(v) =>
                                    v === ''
                                        ? onSecondaryChange('chargedSecondary', undefined)
                                        : onSecondaryChange('chargedSecondary', {
                                              stat: v as 'defense' | 'hp',
                                              pct: config.chargedSecondary?.pct ?? 0,
                                          })
                                }
                                helpLabel={
                                    config.autoFilledFields?.has('chargedSecondary')
                                        ? 'auto-filled'
                                        : undefined
                                }
                                options={[
                                    { value: '', label: 'None' },
                                    { value: 'defense', label: 'Defense' },
                                    { value: 'hp', label: 'Max HP' },
                                ]}
                                className="flex-1"
                            />
                            <Input
                                label="Charged %"
                                type="number"
                                min="0"
                                value={config.chargedSecondary?.pct ?? 0}
                                disabled={!config.chargedSecondary}
                                onChange={(e) =>
                                    onSecondaryChange('chargedSecondary', {
                                        stat: config.chargedSecondary?.stat ?? 'defense',
                                        pct: parseFloat(e.target.value) || 0,
                                    })
                                }
                            />
                        </div>
                    </CollapsibleForm>

                    <Button
                        variant="link"
                        onClick={() => setOpenConditional((v) => !v)}
                        className="w-full flex justify-between items-center mt-4"
                    >
                        <span className="flex items-center gap-2">
                            <ChevronDownIcon
                                className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${openConditional ? 'rotate-180' : ''}`}
                            />
                            Conditional Damage
                        </span>
                    </Button>
                    <CollapsibleForm isVisible={openConditional}>
                        {(
                            [
                                ['activeConditional', 'Active', config.activeConditional],
                                ['chargedConditional', 'Charged', config.chargedConditional],
                            ] as const
                        ).map(([field, label, cond]) => {
                            if (!cond) {
                                return (
                                    <p
                                        key={field}
                                        className="text-xs text-theme-text-secondary mb-2"
                                    >
                                        {label}: no conditional bonus detected.
                                    </p>
                                );
                            }
                            return (
                                <div key={field} className="mb-4">
                                    <div className="text-sm font-semibold mb-1">
                                        {label}: +{cond.pct}%{' '}
                                        {CONDITIONAL_CONDITION_LABELS[cond.condition]}
                                        {cond.cap !== undefined ? ` (max +${cond.cap}%)` : ''}
                                    </div>
                                    {cond.derivable ? (
                                        <p className="text-xs text-theme-text-secondary">
                                            Auto-counted each round from your active{' '}
                                            {cond.condition === 'self-buff'
                                                ? 'buffs'
                                                : 'enemy debuffs'}
                                            .
                                        </p>
                                    ) : (
                                        <Input
                                            label="Count"
                                            type="number"
                                            min="0"
                                            value={cond.manualCount ?? 1}
                                            helpLabel={
                                                config.autoFilledFields?.has(field)
                                                    ? 'auto-filled'
                                                    : undefined
                                            }
                                            onChange={(e) =>
                                                onConditionalChange(field, {
                                                    ...cond,
                                                    manualCount: parseInt(e.target.value) || 0,
                                                })
                                            }
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </CollapsibleForm>

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

                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 mt-4">
                        Ship Buffs
                    </div>
                    <GameBuffPicker
                        label="Ship Buffs"
                        relevantStats={[
                            'attack',
                            'crit',
                            'critDamage',
                            'outgoingDamage',
                            'defensePenetration',
                            'dotDamage',
                        ]}
                        excludeTypes={['effect']}
                        value={config.buffs}
                        onChange={onBuffsChange}
                    />

                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 mt-4">
                        Applied Enemy Debuffs
                    </div>
                    <GameBuffPicker
                        label="Applied Enemy Debuffs"
                        relevantStats={['defense', 'incomingDamage', 'incomingDotDamage']}
                        excludeTypes={['effect']}
                        value={config.enemyDebuffs}
                        onChange={onEnemyDebuffsChange}
                    />

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
