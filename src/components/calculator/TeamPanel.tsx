import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { SelectedGameBuff, TeamShipConfig, CombatStatBlock } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { AffinityName, Ship } from '../../types/ship';
import { GameBuffPicker } from './GameBuffPicker';
import { TeamShipRow } from './TeamShipRow';

interface TeamPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    /** Whether to show the shared attacker buffs/debuffs picker. Defaults to true. */
    showSharedBuffs?: boolean;
    attackerBuffs?: SelectedGameBuff[];
    onAttackerBuffsChange?: (v: SelectedGameBuff[]) => void;
    enemyAffinity: AffinityName;
    teamShips: TeamShipConfig[];
    onAddTeamShip: () => void;
    onRemoveTeamShip: (id: string) => void;
    onSelectTeamShip: (id: string, ship: Ship) => void;
    onTeamShipStartChargedChange: (id: string, checked: boolean) => void;
    onTeamShipSpeedChange: (id: string, speed: number) => void;
    onTeamShipChargeCountChange: (id: string, chargeCount: number) => void;
    onTeamShipBuffsChange: (id: string, buffs: SelectedGameBuff[]) => void;
    onTeamShipEnemyDebuffsChange: (id: string, debuffs: SelectedGameBuff[]) => void;
    onTeamShipStatsChange: (id: string, stats: CombatStatBlock) => void;
    onTeamShipAffinityChange: (id: string, affinity: AffinityName) => void;
    onTeamShipShipSkillsChange: (id: string, shipSkills: ShipSkills) => void;
}

export const TeamPanel: React.FC<TeamPanelProps> = ({
    isOpen,
    onToggle,
    showSharedBuffs = true,
    attackerBuffs = [],
    onAttackerBuffsChange,
    enemyAffinity,
    teamShips,
    onAddTeamShip,
    onRemoveTeamShip,
    onSelectTeamShip,
    onTeamShipStartChargedChange,
    onTeamShipSpeedChange,
    onTeamShipChargeCountChange,
    onTeamShipBuffsChange,
    onTeamShipEnemyDebuffsChange,
    onTeamShipStatsChange,
    onTeamShipAffinityChange,
    onTeamShipShipSkillsChange,
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
                <span className="text-lg font-bold">Team</span>
            </span>
        </Button>
        <CollapsibleForm isVisible={isOpen}>
            <div className="space-y-4 pt-2">
                {showSharedBuffs && onAttackerBuffsChange && (
                    <>
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
                    </>
                )}
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
                                enemyAffinity={enemyAffinity}
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
                                onStatsChange={(stats) => onTeamShipStatsChange(ts.id, stats)}
                                onAffinityChange={(affinity) =>
                                    onTeamShipAffinityChange(ts.id, affinity)
                                }
                                onShipSkillsChange={(shipSkills) =>
                                    onTeamShipShipSkillsChange(ts.id, shipSkills)
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
