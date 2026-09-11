import React from 'react';
import { Button, CloseIcon, EditIcon, InlineNumberEdit } from '../ui';
import { StatBonus } from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';

interface StatBonusRowProps {
    bonus: StatBonus;
    isEditing: boolean;
    onUpdate: (bonus: StatBonus) => void;
    onEdit: () => void;
    onRemove: () => void;
    /** Renders the row with only Remove — no reorder, edit button, or inline number edit. */
    readOnly?: boolean;
}

export const StatBonusRow: React.FC<StatBonusRowProps> = ({
    bonus,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
    readOnly = false,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {getLimitStatLabel(bonus.stat)} ({' '}
                {readOnly ? (
                    bonus.percentage
                ) : (
                    <InlineNumberEdit
                        value={bonus.percentage}
                        label={`Edit ${getLimitStatLabel(bonus.stat)} scale percentage`}
                        onSave={(v) => v !== undefined && onUpdate({ ...bonus, percentage: v })}
                        min={0}
                        disabled={isEditing}
                    >
                        {bonus.percentage}
                    </InlineNumberEdit>
                )}
                {'%) — '}
                <span className="text-xs text-theme-text-secondary">
                    {bonus.mode === 'multiplier' ? 'Multiplier' : 'Additive'}
                </span>
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            {!readOnly && (
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
            )}
            <Button
                aria-label="Remove bonus"
                variant="danger"
                size="sm"
                onClick={onRemove}
                className={readOnly ? 'ml-auto' : undefined}
            >
                <CloseIcon />
            </Button>
        </div>
    );
};
