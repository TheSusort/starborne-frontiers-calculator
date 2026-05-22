import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { SelectedGameBuff } from '../../types/calculator';
import { GameBuffPicker } from './GameBuffPicker';

interface DefenseSettingsPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    defenseBuffs: SelectedGameBuff[];
    onDefenseBuffsChange: (v: SelectedGameBuff[]) => void;
}

export const DefenseSettingsPanel: React.FC<DefenseSettingsPanelProps> = ({
    isOpen,
    onToggle,
    defenseBuffs,
    onDefenseBuffsChange,
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
                <p className="text-sm text-theme-text-secondary">
                    Shared buffs applied to all ship configurations
                </p>
                <GameBuffPicker
                    label="Defense Buffs / Debuffs"
                    relevantStats={['defense', 'incomingDamage', 'security']}
                    excludeTypes={['effect']}
                    value={defenseBuffs}
                    onChange={onDefenseBuffsChange}
                    noEffectLabel="No defensive effect"
                />
            </div>
        </CollapsibleForm>
    </div>
);
