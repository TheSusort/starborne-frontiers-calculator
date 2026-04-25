import React from 'react';
import { Button, CloseIcon, EditIcon, InlineNumberEdit } from '../ui';
import { SetPriority } from '../../types/autogear';
import { GEAR_SETS } from '../../constants/gearSets';

interface SetPriorityRowProps {
    priority: SetPriority;
    isEditing: boolean;
    onUpdate: (priority: SetPriority) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const SetPriorityRow: React.FC<SetPriorityRowProps> = ({
    priority,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {GEAR_SETS[priority.setName].name} ({' '}
                <InlineNumberEdit
                    value={priority.count}
                    onSave={(v) => v !== undefined && onUpdate({ ...priority, count: v })}
                    min={0}
                    max={6}
                    disabled={isEditing}
                >
                    {priority.count}
                </InlineNumberEdit>
                {' pieces)'}
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit set priority"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
                title="Edit set priority"
            >
                <EditIcon />
            </Button>
            <Button aria-label="Remove set priority" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
