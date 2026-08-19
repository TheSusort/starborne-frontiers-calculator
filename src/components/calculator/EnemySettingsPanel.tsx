import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SelectedGameBuff, EnemyBaseClass } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import { GameBuffPicker } from './GameBuffPicker';

interface EnemySettingsPanelProps {
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
    enemyBuffs: SelectedGameBuff[];
    onEnemyBuffsChange: (v: SelectedGameBuff[]) => void;
    enemyAffinity: AffinityName;
    onEnemyAffinityChange: (v: AffinityName) => void;
    enemyType?: EnemyBaseClass;
    onEnemyTypeChange: (v: EnemyBaseClass | undefined) => void;
    /** Rendered below the stat grid — the DPS page supplies the enemy ship's offensive stats
     *  and kit editor here, so the whole opponent is configured in one place. */
    children?: React.ReactNode;
}

export const EnemySettingsPanel: React.FC<EnemySettingsPanelProps> = ({
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
    enemyBuffs,
    onEnemyBuffsChange,
    children,
    enemyAffinity,
    onEnemyAffinityChange,
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
                <span className="text-lg font-bold">Enemy Target</span>
            </span>
        </Button>
        <CollapsibleForm isVisible={isOpen}>
            <div className="space-y-4 pt-2">
                <p className="text-sm text-theme-text-secondary">
                    The target is a real, destructible ship: it takes damage and dies once its HP
                    reaches 0, ending the fight on that round — each config below then reports how
                    many rounds it took. Set its stats manually — the default HP is high enough that
                    most configs will not finish it off within the round window, so you can see
                    steady-state DPS as well as time-to-kill. Lower it to see how fast a loadout can
                    secure the kill.
                </p>
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
                        // `min` is a browser-level HINT only (it reaches the DOM because `Input`
                        // spreads `...props`); the handler deliberately does NOT clamp. The engine's
                        // normalization boundary is the ONE place that accommodates an
                        // under-specified input — `MIN_TARGETABLE_MAX_HP` in normalizeRoster.ts
                        // floors an absent or zero enemy max HP — and a second clamp here would be a
                        // second accommodation site, the worse of the two: `Math.max(1, …)` turns a
                        // cleared field into `hp: 1`, which the wipe rule ends in round 1, and it
                        // makes a leading digit sticky (delete-then-retype 500000 yields 1500000).
                        min="1"
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
                {children}
            </div>
        </CollapsibleForm>
    </div>
);
