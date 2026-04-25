import React from 'react';
import { Button, CloseIcon, EditIcon, InlineNumberEdit } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusRowProps {
    bonus: StatBonus;
    isEditing: boolean;
    onUpdate: (bonus: StatBonus) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const StatBonusRow: React.FC<StatBonusRowProps> = ({
    bonus,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
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
