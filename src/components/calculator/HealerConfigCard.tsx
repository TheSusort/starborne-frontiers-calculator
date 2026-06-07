import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { HealerShipConfig, HealerShipConfigUpdateableField } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { HealingSimulationResult } from '../../utils/calculators/healingEngineAdapter';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon, StatCard } from '../ui';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { useShips } from '../../contexts/ShipsContext';
import { getSkillRowForSlot } from '../../utils/ship/skillRows';
import { SkillSlotList } from '../skills/SkillSlotList';

interface HealerConfigCardProps {
    config: HealerShipConfig;
    isBest: boolean;
    isComparing: boolean;
    simResult: HealingSimulationResult | undefined;
    bestEffectiveHealing: number | undefined;
    onRemove: () => void;
    onUpdate: (field: HealerShipConfigUpdateableField, value: string | number) => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onShipSkillsChange: (shipSkills: ShipSkills) => void;
}

/** Compact labelled group inside the config card; children are evenly spaced. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">
            {title}
        </div>
        <div className="space-y-3">{children}</div>
    </div>
);

const SummaryRow: React.FC<{
    label: string;
    value: React.ReactNode;
    valueClassName?: string;
}> = ({ label, value, valueClassName }) => (
    <div className="flex justify-between text-sm">
        <span className="text-theme-text-secondary">{label}</span>
        <span className={valueClassName}>{value}</span>
    </div>
);

export const HealerConfigCard: React.FC<HealerConfigCardProps> = ({
    config,
    isBest,
    isComparing,
    simResult,
    bestEffectiveHealing,
    onRemove,
    onUpdate,
    onSelectShip,
    onStartChargedChange,
    onShipSkillsChange,
}) => {
    const [openAdvanced, setOpenAdvanced] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;
    const hasPassive =
        config.shipSkills.slots.some((s) => s.slot === 'passive') ||
        (selectedShip ? !!getSkillRowForSlot(selectedShip, 'passive') : false);

    const summary = simResult?.summary;
    const overhealPctOfRaw =
        summary && summary.totalHealing > 0
            ? Math.round((summary.totalOverheal / summary.totalHealing) * 100)
            : 0;
    const vsBest =
        isComparing && !isBest && bestEffectiveHealing && summary
            ? ((summary.totalEffectiveHealing - bestEffectiveHealing) / bestEffectiveHealing) * 100
            : null;

    return (
        <div className={`card ${isBest ? '!border-primary' : ''}`}>
            <div className="space-y-3">
                <ShipSelector
                    selected={selectedShip ?? null}
                    onSelect={onSelectShip}
                    variant="compact"
                />
                <div className="flex items-end justify-between gap-2">
                    <Input
                        label="Config name"
                        value={config.name}
                        onChange={(e) => onUpdate('name', e.target.value)}
                        className="font-bold"
                    />
                    <Button variant="danger" onClick={onRemove} aria-label="Remove healer">
                        <CloseIcon />
                    </Button>
                </div>
            </div>

            <div className="mt-4 space-y-4">
                <Section title="Stats">
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="HP"
                            type="number"
                            min="0"
                            value={config.hp}
                            onChange={(e) => onUpdate('hp', parseInt(e.target.value) || 0)}
                        />
                        <Input
                            label="Heal Modifier (%)"
                            type="number"
                            min="0"
                            value={config.healModifier}
                            onChange={(e) =>
                                onUpdate('healModifier', parseInt(e.target.value) || 0)
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
                        <Input
                            label="Speed"
                            type="number"
                            min="0"
                            value={config.speed}
                            onChange={(e) =>
                                onUpdate('speed', Math.max(0, parseInt(e.target.value) || 0))
                            }
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
                        <Section title="Heal Sources">
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Attack"
                                    type="number"
                                    min="0"
                                    value={config.attack}
                                    onChange={(e) =>
                                        onUpdate('attack', parseInt(e.target.value) || 0)
                                    }
                                    helpLabel="source stat for attack-based heals"
                                />
                                <Input
                                    label="Defense"
                                    type="number"
                                    min="0"
                                    value={config.defence}
                                    onChange={(e) =>
                                        onUpdate('defence', parseInt(e.target.value) || 0)
                                    }
                                    helpLabel="source stat for defense-based heals"
                                />
                            </div>
                        </Section>

                        <Section title="Charge">
                            <Input
                                label="Charge Count"
                                type="number"
                                min="0"
                                value={config.chargeCount}
                                onChange={(e) =>
                                    onUpdate('chargeCount', parseInt(e.target.value) || 0)
                                }
                            />
                            <Checkbox
                                id={`start-charged-${config.id}`}
                                label="Start Charged"
                                checked={config.startCharged}
                                onChange={onStartChargedChange}
                            />
                        </Section>

                        <Section title="Debuff Landing">
                            <Input
                                label="Hacking"
                                type="number"
                                min="0"
                                value={config.hacking}
                                onChange={(e) => onUpdate('hacking', parseInt(e.target.value) || 0)}
                                helpLabel="cleanse / debuff landing vs enemy security"
                            />
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

                {summary && (
                    <div className="mt-4 pt-4 border-t border-dark-border space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <StatCard
                                title="Effective Healing"
                                value={summary.totalEffectiveHealing.toLocaleString()}
                                color={isBest ? 'green' : 'blue'}
                            />
                            <StatCard
                                title="Shield Absorbed"
                                value={summary.totalShieldAbsorbed.toLocaleString()}
                                color="purple"
                            />
                        </div>

                        <SummaryRow
                            label="Overheal"
                            value={`${summary.totalOverheal.toLocaleString()} (${overhealPctOfRaw}% of raw)`}
                        />
                        <SummaryRow
                            label="Survival"
                            value={
                                summary.destroyedRound !== undefined
                                    ? `Destroyed round ${summary.destroyedRound}`
                                    : `Survived ${simResult.rounds.length} ${simResult.rounds.length === 1 ? 'round' : 'rounds'}`
                            }
                            valueClassName={
                                summary.destroyedRound !== undefined
                                    ? 'text-red-400 font-medium'
                                    : 'text-green-400 font-medium'
                            }
                        />

                        <div className="pt-2 border-t border-dark-border space-y-2">
                            <SummaryRow
                                label="Direct Heal (raw)"
                                value={summary.totalDirectHeal.toLocaleString()}
                            />
                            <SummaryRow
                                label="Heal Over Time (raw)"
                                value={summary.totalHotHeal.toLocaleString()}
                            />
                            <SummaryRow
                                label="Shield Granted (raw)"
                                value={summary.totalShield.toLocaleString()}
                            />
                            <SummaryRow
                                label="Cleanses"
                                value={summary.totalCleanses.toLocaleString()}
                            />
                            {summary.teamTotalHealing !== undefined && (
                                <SummaryRow
                                    label="Team Healing (raw)"
                                    value={summary.teamTotalHealing.toLocaleString()}
                                />
                            )}
                        </div>

                        {vsBest !== null && (
                            <SummaryRow
                                label="Compared to best"
                                value={`${vsBest.toFixed(2)}%`}
                                valueClassName="text-red-400"
                            />
                        )}
                        {isBest && isComparing && (
                            <div className="text-primary text-sm text-center">
                                Best healer configuration
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
