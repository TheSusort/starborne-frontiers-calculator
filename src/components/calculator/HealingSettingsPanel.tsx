import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { SelectedGameBuff } from '../../types/calculator';
import { GameBuffPicker } from './GameBuffPicker';

interface HealingSettingsPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    rounds: number;
    onRoundsChange: (v: number) => void;
    healerBuffs: SelectedGameBuff[];
    onHealerBuffsChange: (v: SelectedGameBuff[]) => void;
}

export const HealingSettingsPanel: React.FC<HealingSettingsPanelProps> = ({
    isOpen,
    onToggle,
    rounds,
    onRoundsChange,
    healerBuffs,
    onHealerBuffsChange,
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                </div>
                <p className="text-sm text-theme-text-secondary">
                    Shared buffs applied to all healer configurations
                </p>
                <GameBuffPicker
                    label="Healer Buffs / Debuffs"
                    relevantStats={['crit', 'critDamage', 'outgoingHeal']}
                    excludeTypes={['effect']}
                    value={healerBuffs}
                    onChange={onHealerBuffsChange}
                />
            </div>
        </CollapsibleForm>
    </div>
);
