import React from 'react';
import { Button, ChevronUpIcon, ChevronDownIcon, CloseIcon, EditIcon, InlineNumberEdit } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusRowProps {
    bonus: StatBonus;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (bonus: StatBonus) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

export const StatBonusRow: React.FC<StatBonusRowProps> = ({
    bonus,
    isEditing,
    canMoveUp,
    canMoveDown,
    onUpdate,
    onEdit,
    onMoveUp,
    onMoveDown,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <div className="flex flex-col">
                <Button
                    aria-label="Move bonus up"
                    variant="secondary"
                    size="xs"
                    onClick={onMoveUp}
                    disabled={!canMoveUp || isEditing}
                    className="!p-0.5"
                >
                    <ChevronUpIcon className="w-3 h-3" />
                </Button>
                <Button
                    aria-label="Move bonus down"
                    variant="secondary"
                    size="xs"
                    onClick={onMoveDown}
                    disabled={!canMoveDown || isEditing}
                    className="!p-0.5"
                >
                    <ChevronDownIcon className="w-3 h-3" />
                </Button>
            </div>
            <span>
                {STATS[bonus.stat as StatName].label} ({' '}
                <InlineNumberEdit
                    value={bonus.percentage}
                    onSave={(v) => v !== undefined && onUpdate({ ...bonus, percentage: v })}
                    min={0}
                    disabled={isEditing}
                >
                    {bonus.percentage}
                </InlineNumberEdit>
                {'%) — '}
                <span className="text-xs text-theme-text-secondary">
                    {bonus.mode === 'multiplier' ? 'Multiplier' : 'Additive'}
                </span>
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit bonus"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
                title="Edit bonus"
            >
                <EditIcon />
            </Button>
            <Button aria-label="Remove bonus" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
