import React from 'react';
import {
    Button,
    ChevronUpIcon,
    ChevronDownIcon,
    CloseIcon,
    EditIcon,
    InlineNumberEdit,
} from '../ui';
import type { FleetBuff } from '../../types/autogear';
import { STATS } from '../../constants';

interface FleetBuffRowProps {
    buff: FleetBuff;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (buff: FleetBuff) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

export const FleetBuffRow: React.FC<FleetBuffRowProps> = ({
    buff,
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
                {canMoveUp && (
                    <Button
                        aria-label="Move buff up"
                        variant="secondary"
                        size="xs"
                        onClick={onMoveUp}
                        disabled={isEditing}
                        className="!p-0.5"
                    >
                        <ChevronUpIcon className="w-3 h-3" />
                    </Button>
                )}
                {canMoveDown && (
                    <Button
                        aria-label="Move buff down"
                        variant="secondary"
                        size="xs"
                        onClick={onMoveDown}
                        disabled={isEditing}
                        className="!p-0.5"
                    >
                        <ChevronDownIcon className="w-3 h-3" />
                    </Button>
                )}
            </div>
            <span>
                {STATS[buff.stat].label} +
                <InlineNumberEdit
                    value={buff.percentage}
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
