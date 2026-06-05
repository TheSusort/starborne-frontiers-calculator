import React, { useState, useEffect } from 'react';
import { Ship, AffinityName } from '../../types/ship';
import { TeamShipConfig, SelectedGameBuff } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { CloseIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { ShipSelector } from '../ship/ShipSelector';
import { ShipSkillList } from '../ship/ShipSkillList';
import { getSkillRowForSlot } from '../../utils/ship/skillRows';
import { SkillSlotList } from '../skills/SkillSlotList';
import { GameBuffPicker } from './GameBuffPicker';

type TeamShipStats = NonNullable<TeamShipConfig['stats']>;

interface TeamShipRowProps {
    config: TeamShipConfig;
    onRemove: () => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onSpeedChange: (speed: number) => void;
    onChargeCountChange: (chargeCount: number) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
    onEnemyDebuffsChange: (debuffs: SelectedGameBuff[]) => void;
    onStatsChange: (stats: TeamShipStats) => void;
    onAffinityChange: (affinity: AffinityName) => void;
    onShipSkillsChange: (shipSkills: ShipSkills) => void;
}

export const TeamShipRow: React.FC<TeamShipRowProps> = ({
    config,
    onRemove,
    onSelectShip,
    onStartChargedChange,
    onSpeedChange,
    onChargeCountChange,
    onBuffsChange,
    onEnemyDebuffsChange,
    onStatsChange,
    onAffinityChange,
    onShipSkillsChange,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;

    useEffect(() => {
        if (!selectedShip) setSkillRefOpen(false);
    }, [selectedShip]);

    const updateStat = (field: keyof TeamShipStats, value: number) => {
        if (!config.stats) return;
        onStatsChange({ ...config.stats, [field]: value });
    };

    // Mirror ShipConfigCard: show the Passive slot whenever the ship has passive skill text to
    // read/edit — not only when the parser auto-filled abilities.
    const hasPassive =
        !!config.shipSkills?.slots.some((s) => s.slot === 'passive') ||
        (selectedShip ? !!getSkillRowForSlot(selectedShip, 'passive') : false);

    return (
        <div className="card space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <ShipSelector
                        selected={selectedShip ?? null}
                        onSelect={onSelectShip}
                        variant="compact"
                    />
                </div>
                <Button
                    variant="link"
                    onClick={() => setExpanded((v) => !v)}
                    aria-label="Toggle team ship details"
                >
                    <ChevronDownIcon
                        className={`h-4 w-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                    />
                </Button>
                <Button variant="danger" size="sm" onClick={onRemove} aria-label="Remove team ship">
                    <CloseIcon />
                </Button>
            </div>

            {/* Expanded body */}
            <CollapsibleForm isVisible={expanded}>
                <div className="space-y-4 pt-2">
                    {/* Skill Reference */}
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
                                <div className="pt-2 pb-4 border-b border-dark-border">
                                    <ShipSkillList ship={selectedShip} />
                                </div>
                            </CollapsibleForm>
                        </>
                    )}

                    {/* Combat stats */}
                    {config.stats && (
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Attack"
                                type="number"
                                min="0"
                                value={config.stats.attack}
                                onChange={(e) =>
                                    updateStat('attack', Math.max(0, parseInt(e.target.value) || 0))
                                }
                            />
                            <Input
                                label="Crit Rate (%)"
                                type="number"
                                min="0"
                                max="100"
                                value={config.stats.crit}
                                onChange={(e) =>
                                    updateStat('crit', Math.max(0, parseInt(e.target.value) || 0))
                                }
                            />
                            <Input
                                label="Crit Damage (%)"
                                type="number"
                                min="0"
                                value={config.stats.critDamage}
                                onChange={(e) =>
                                    updateStat(
                                        'critDamage',
                                        Math.max(0, parseInt(e.target.value) || 0)
                                    )
                                }
                            />
                            <Input
                                label="Defense Penetration (%)"
                                type="number"
                                min="0"
                                max="100"
                                value={config.stats.defensePenetration}
                                onChange={(e) =>
                                    updateStat(
                                        'defensePenetration',
                                        Math.max(0, parseInt(e.target.value) || 0)
                                    )
                                }
                            />
                            <Input
                                label="Hacking"
                                type="number"
                                min="0"
                                value={config.stats.hacking}
                                onChange={(e) =>
                                    updateStat(
                                        'hacking',
                                        Math.max(0, parseInt(e.target.value) || 0)
                                    )
                                }
                            />
                        </div>
                    )}

                    {/* Turn-order controls */}
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Speed"
                            type="number"
                            min="0"
                            value={config.speed}
                            onChange={(e) =>
                                onSpeedChange(Math.max(0, parseInt(e.target.value) || 0))
                            }
                        />
                        <Input
                            label="Charge count"
                            type="number"
                            min="0"
                            value={config.chargeCount}
                            onChange={(e) =>
                                onChargeCountChange(Math.max(0, parseInt(e.target.value) || 0))
                            }
                        />
                    </div>

                    {/* Affinity */}
                    <div>
                        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                            Affinity
                        </div>
                        <Select
                            value={config.affinity ?? 'antimatter'}
                            onChange={(v) => onAffinityChange(v as AffinityName)}
                            options={[
                                { value: 'antimatter', label: 'Antimatter' },
                                { value: 'thermal', label: 'Thermal' },
                                { value: 'chemical', label: 'Chemical' },
                                { value: 'electric', label: 'Electric' },
                            ]}
                            className="w-full"
                        />
                    </div>

                    {/* Start Charged */}
                    <Checkbox
                        id={`team-start-charged-${config.id}`}
                        label="Start Charged"
                        checked={config.startCharged}
                        onChange={onStartChargedChange}
                    />

                    {/* Skills */}
                    {config.shipSkills && (
                        <div>
                            <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                                Skills
                            </div>
                            <SkillSlotList
                                shipSkills={config.shipSkills}
                                hasPassive={hasPassive}
                                ship={selectedShip}
                                onChange={onShipSkillsChange}
                            />
                        </div>
                    )}

                    {/* Manual extra buffs */}
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mt-4 mb-2">
                        Manual extra buffs (granted to attacker)
                    </div>
                    <GameBuffPicker
                        label="Manual extra buffs (granted to attacker)"
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

                    {/* Manual extra enemy debuffs */}
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mt-4 mb-2">
                        Manual extra enemy debuffs
                    </div>
                    <GameBuffPicker
                        label="Manual extra enemy debuffs"
                        relevantStats={['defense', 'incomingDamage', 'incomingDotDamage']}
                        excludeTypes={['effect']}
                        value={config.enemyDebuffs}
                        onChange={onEnemyDebuffsChange}
                    />
                </div>
            </CollapsibleForm>
        </div>
    );
};
