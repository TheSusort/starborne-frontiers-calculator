import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SelectedGameBuff, TeamShipConfig, EnemyBaseClass } from '../../types/calculator';
import { AffinityName, Ship } from '../../types/ship';
import { GameBuffPicker } from './GameBuffPicker';
import { TeamShipRow } from './TeamShipRow';

interface CombatSettingsPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    enemyDefense: number;
    onEnemyDefenseChange: (v: number) => void;
    enemyHp: number;
    onEnemyHpChange: (v: number) => void;
    enemySecurity: number;
    onEnemySecurityChange: (v: number) => void;
    enemySpeed: number;
    onEnemySpeedChange: (v: number) => void;
    rounds: number;
    onRoundsChange: (v: number) => void;
    attackerBuffs: SelectedGameBuff[];
    onAttackerBuffsChange: (v: SelectedGameBuff[]) => void;
    enemyBuffs: SelectedGameBuff[];
    onEnemyBuffsChange: (v: SelectedGameBuff[]) => void;
    enemyAffinity: AffinityName;
    onEnemyAffinityChange: (v: AffinityName) => void;
    teamShips: TeamShipConfig[];
    onAddTeamShip: () => void;
    onRemoveTeamShip: (id: string) => void;
    onSelectTeamShip: (id: string, ship: Ship) => void;
    onTeamShipStartChargedChange: (id: string, checked: boolean) => void;
    onTeamShipSpeedChange: (id: string, speed: number) => void;
    onTeamShipChargeCountChange: (id: string, chargeCount: number) => void;
    onTeamShipBuffsChange: (id: string, buffs: SelectedGameBuff[]) => void;
    onTeamShipEnemyDebuffsChange: (id: string, debuffs: SelectedGameBuff[]) => void;
    enemyType?: EnemyBaseClass;
    onEnemyTypeChange: (v: EnemyBaseClass | undefined) => void;
}

export const CombatSettingsPanel: React.FC<CombatSettingsPanelProps> = ({
    isOpen,
    onToggle,
    enemyDefense,
    onEnemyDefenseChange,
    enemyHp,
    onEnemyHpChange,
    enemySecurity,
    onEnemySecurityChange,
    enemySpeed,
    onEnemySpeedChange,
    rounds,
    onRoundsChange,
    attackerBuffs,
    onAttackerBuffsChange,
    enemyBuffs,
    onEnemyBuffsChange,
    enemyAffinity,
    onEnemyAffinityChange,
    teamShips,
    onAddTeamShip,
    onRemoveTeamShip,
    onSelectTeamShip,
    onTeamShipStartChargedChange,
    onTeamShipSpeedChange,
    onTeamShipChargeCountChange,
    onTeamShipBuffsChange,
    onTeamShipEnemyDebuffsChange,
    enemyType,
    onEnemyTypeChange,
}) => (
    <div className="card space-y-2">
        <Button
            variant="link"
            onClick={onToggle}
            className="w-[calc(100%+1.5rem)] flex justify-between items-center -m-3 !p-3"
        >
            <span className="flex items-center gap-2">
                <ChevronDownIcon
                    className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                />
                <span className="text-lg font-bold">Combat Settings</span>
            </span>
        </Button>
        <CollapsibleForm isVisible={isOpen}>
            <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <Input
                        label="Enemy Defense"
                        type="number"
                        value={enemyDefense}
                        onChange={(e) => onEnemyDefenseChange(parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Enemy HP"
                        type="number"
                        value={enemyHp}
                        onChange={(e) => onEnemyHpChange(parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Enemy Security"
                        type="number"
                        min="0"
                        value={enemySecurity}
                        onChange={(e) => onEnemySecurityChange(parseInt(e.target.value) || 0)}
                    />
                    <Input
                        label="Enemy Speed"
                        type="number"
                        min="0"
                        value={enemySpeed}
                        onChange={(e) =>
                            onEnemySpeedChange(Math.max(0, parseInt(e.target.value) || 0))
                        }
                    />
                    <Input
                        label="Rounds"
                        type="number"
                        min="1"
                        max="50"
                        value={rounds}
                        onChange={(e) =>
                            onRoundsChange(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
                        }
                    />
                    <Select
                        label="Enemy Affinity"
                        value={enemyAffinity ?? 'antimatter'}
                        onChange={(v) => onEnemyAffinityChange(v as AffinityName)}
                        options={[
                            { value: 'antimatter', label: 'Antimatter' },
                            { value: 'thermal', label: 'Thermal' },
                            { value: 'chemical', label: 'Chemical' },
                            { value: 'electric', label: 'Electric' },
                        ]}
                    />
                    <Select
                        label="Enemy Type"
                        value={enemyType ?? ''}
                        options={[
                            { value: '', label: 'Any / Unknown' },
                            { value: 'Attacker', label: 'Attacker' },
                            { value: 'Defender', label: 'Defender' },
                            { value: 'Debuffer', label: 'Debuffer' },
                            { value: 'Supporter', label: 'Supporter' },
                        ]}
                        onChange={(v) =>
                            onEnemyTypeChange(v === '' ? undefined : (v as EnemyBaseClass))
                        }
                    />
                </div>
                <p className="text-sm text-theme-text-secondary">
                    Shared enemy buffs applied to all ship configurations
                </p>
                <GameBuffPicker
                    label="Enemy Buffs / Debuffs"
                    relevantStats={['defense', 'incomingDamage', 'incomingDotDamage']}
                    excludeTypes={['effect']}
                    value={enemyBuffs}
                    onChange={onEnemyBuffsChange}
                />
                <p className="text-sm text-theme-text-secondary">
                    Shared attacker buffs applied to all ship configurations
                </p>
                <GameBuffPicker
                    label="Attacker Buffs / Debuffs"
                    relevantStats={[
                        'attack',
                        'crit',
                        'critDamage',
                        'outgoingDamage',
                        'defensePenetration',
                        'dotDamage',
                    ]}
                    excludeTypes={['effect']}
                    value={attackerBuffs}
                    onChange={onAttackerBuffsChange}
                />
                <div className="border-t border-dark-border pt-4">
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-3">
                        Team (up to 4)
                    </div>
                    <p className="text-sm text-theme-text-secondary mb-3">
                        Team ships contribute their buffs and debuffs to all ship comparisons
                    </p>
                    <div className="space-y-2">
                        {teamShips.map((ts) => (
                            <TeamShipRow
                                key={ts.id}
                                config={ts}
                                onRemove={() => onRemoveTeamShip(ts.id)}
                                onSelectShip={(ship) => onSelectTeamShip(ts.id, ship)}
                                onStartChargedChange={(checked) =>
                                    onTeamShipStartChargedChange(ts.id, checked)
                                }
                                onSpeedChange={(speed) => onTeamShipSpeedChange(ts.id, speed)}
                                onChargeCountChange={(chargeCount) =>
                                    onTeamShipChargeCountChange(ts.id, chargeCount)
                                }
                                onBuffsChange={(buffs) => onTeamShipBuffsChange(ts.id, buffs)}
                                onEnemyDebuffsChange={(debuffs) =>
                                    onTeamShipEnemyDebuffsChange(ts.id, debuffs)
                                }
                            />
                        ))}
                        {teamShips.length < 4 && (
                            <Button variant="secondary" size="sm" onClick={onAddTeamShip}>
                                + Add team ship
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </CollapsibleForm>
    </div>
);
