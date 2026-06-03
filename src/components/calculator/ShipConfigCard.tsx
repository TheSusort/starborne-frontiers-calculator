import React, { useState } from 'react';
import { Ship, AffinityName } from '../../types/ship';
import { Select } from '../ui/Select';
import { getAffinityMatchup } from '../../utils/calculators/affinityUtils';
import {
    DPSShipConfig,
    DPSShipConfigUpdateableField,
    AttackerBuffTotals,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { getSkillRowForSlot } from '../../utils/ship/skillRows';
import { SkillSlotList } from '../skills/SkillSlotList';
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
    onShipSkillsChange: (shipSkills: ShipSkills) => void;
    onAllyChargeChange: (value: number) => void;
    enemyAffinity: AffinityName;
    enemySecurity: number;
}

/**
 * Compact labelled group inside the config card. `aside` renders flush-right in the
 * header row (used for the affinity matchup badge). Children are evenly spaced.
 */
const Section: React.FC<{
    title: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, aside, children }) => (
    <div>
        <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                {title}
            </span>
            {aside}
        </div>
        <div className="space-y-3">{children}</div>
    </div>
);

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
    onShipSkillsChange,
    onAllyChargeChange,
    enemyAffinity,
    enemySecurity,
}) => {
    const [openAdvanced, setOpenAdvanced] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;
    // Show the Passive slot whenever the ship has passive skill text to read/edit — not only
    // when the parser auto-filled abilities. Defensive/repair passives (e.g. Anemone) parse to
    // nothing but still need the Edit button so users can read and add abilities manually.
    const hasPassive =
        config.shipSkills.slots.some((s) => s.slot === 'passive') ||
        (selectedShip ? !!getSkillRowForSlot(selectedShip, 'passive') : false);

    const affinityMatchup = getAffinityMatchup(config.affinity, enemyAffinity);
    const affinityBadge =
        affinityMatchup === 'advantage' ? (
            <span className="text-xs font-medium text-green-400">Advantage</span>
        ) : affinityMatchup === 'disadvantage' ? (
            <span className="text-xs font-medium text-red-400">Disadvantage</span>
        ) : null;

    return (
        <div className={`p-4 bg-dark border ${isBest ? 'border-primary' : 'border-dark-border'}`}>
            {/* Header: ship picker + editable name + remove */}
            <div className="space-y-3">
                <ShipSelector
                    selected={selectedShip ?? null}
                    onSelect={onSelectShip}
                    variant="compact"
                />
                <div className="flex items-center justify-between gap-2">
                    <Input
                        value={config.name}
                        onChange={(e) => onUpdate('name', e.target.value)}
                        className="font-bold"
                    />
                    <Button variant="danger" onClick={onRemove} aria-label="Remove ship">
                        <CloseIcon />
                    </Button>
                </div>
            </div>

            <div className="mt-4 space-y-4">
                <Section title="Stats">
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Attack"
                            type="number"
                            value={config.attack}
                            onChange={(e) => onUpdate('attack', parseInt(e.target.value) || 0)}
                        />
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
                </Section>

                <Button
                    variant="link"
                    onClick={() => setOpenAdvanced((v) => !v)}
                    className="w-full flex justify-between items-center"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDownIcon
                            className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${openAdvanced ? 'rotate-180' : ''}`}
                        />
                        {openAdvanced ? 'Hide' : 'Show'} Advanced
                    </span>
                </Button>

                <CollapsibleForm isVisible={openAdvanced}>
                    <div className="space-y-4">
                        <Section title="Affinity" aside={affinityBadge}>
                            <Select
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
                                className="w-full"
                            />
                        </Section>

                        <Section title="Charge">
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Charge Count"
                                    type="number"
                                    min="0"
                                    value={config.chargeCount}
                                    onChange={(e) =>
                                        onUpdate('chargeCount', parseInt(e.target.value) || 0)
                                    }
                                />
                                <Input
                                    label="Ally charges / round"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={config.allyChargePerRound ?? 0}
                                    helpLabel="from supporters (e.g. Castor, Liberator)"
                                    onChange={(e) =>
                                        onAllyChargeChange(parseFloat(e.target.value) || 0)
                                    }
                                />
                            </div>
                            <Checkbox
                                id={`start-charged-${config.id}`}
                                label="Start Charged"
                                checked={config.startCharged}
                                onChange={onStartChargedChange}
                            />
                        </Section>

                        <Section title="Debuff Landing">
                            <div>
                                <Input
                                    label="Hacking"
                                    type="number"
                                    min="0"
                                    value={config.hacking ?? 200}
                                    onChange={(e) =>
                                        onUpdate('hacking', parseInt(e.target.value) || 0)
                                    }
                                />
                                <p className="text-xs text-theme-text-secondary mt-1">
                                    Landing:{' '}
                                    {Math.min(
                                        100,
                                        Math.max(0, (config.hacking ?? 200) - enemySecurity)
                                    )}
                                    % vs enemy
                                </p>
                            </div>
                        </Section>

                        <Section title="Damage Sources">
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Defense"
                                    type="number"
                                    min="0"
                                    value={config.defence}
                                    onChange={(e) =>
                                        onUpdate('defence', parseInt(e.target.value) || 0)
                                    }
                                    helpLabel="source stat for Defense-based damage"
                                />
                                <Input
                                    label="HP"
                                    type="number"
                                    min="0"
                                    value={config.hp}
                                    onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                                    helpLabel="source stat for HP-based damage"
                                />
                            </div>
                        </Section>

                        <Section title="Skills">
                            <SkillSlotList
                                shipSkills={config.shipSkills}
                                hasPassive={hasPassive}
                                ship={selectedShip}
                                onChange={onShipSkillsChange}
                            />
                        </Section>
                    </div>
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
