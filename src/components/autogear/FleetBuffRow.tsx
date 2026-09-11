import React from 'react';
import { Button, CloseIcon, EditIcon, InlineNumberEdit } from '../ui';
import type { FleetBuff } from '../../types/autogear';
import { STATS } from '../../constants';

interface FleetBuffRowProps {
    buff: FleetBuff;
    isEditing: boolean;
    onUpdate: (buff: FleetBuff) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const FleetBuffRow: React.FC<FleetBuffRowProps> = ({
    buff,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {STATS[buff.stat]?.label ?? buff.stat} +
                <InlineNumberEdit
                    value={buff.percentage}
                    label={`Edit ${STATS[buff.stat]?.label ?? buff.stat} buff percentage`}
                    onSave={(v) => v !== undefined && onUpdate({ ...buff, percentage: v })}
                    min={0}
                    disabled={isEditing}
                >
                    {buff.percentage}
                </InlineNumberEdit>
                %
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit buff"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
                title="Edit buff"
            >
                <EditIcon />
            </Button>
            <Button aria-label="Remove buff" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
