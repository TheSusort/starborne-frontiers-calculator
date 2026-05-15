import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SelectedGameBuff } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import { GameBuffPicker } from './GameBuffPicker';

interface CombatSettingsPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    enemyDefense: number;
    onEnemyDefenseChange: (v: number) => void;
    enemyHp: number;
    onEnemyHpChange: (v: number) => void;
    rounds: number;
    onRoundsChange: (v: number) => void;
    attackerBuffs: SelectedGameBuff[];
    onAttackerBuffsChange: (v: SelectedGameBuff[]) => void;
    enemyBuffs: SelectedGameBuff[];
    onEnemyBuffsChange: (v: SelectedGameBuff[]) => void;
    enemyAffinity: AffinityName;
    onEnemyAffinityChange: (v: AffinityName) => void;
}

export const CombatSettingsPanel: React.FC<CombatSettingsPanelProps> = ({
    isOpen,
    onToggle,
    enemyDefense,
    onEnemyDefenseChange,
    enemyHp,
    onEnemyHpChange,
    rounds,
    onRoundsChange,
    attackerBuffs,
    onAttackerBuffsChange,
    enemyBuffs,
    onEnemyBuffsChange,
    enemyAffinity,
    onEnemyAffinityChange,
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            </div>
        </CollapsibleForm>
    </div>
);
