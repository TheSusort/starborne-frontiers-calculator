import React, { useRef, useState } from 'react';
import {
    Button,
    ChevronUpIcon,
    ChevronDownIcon,
    CloseIcon,
    EditIcon,
    InlineNumberEdit,
    Tooltip,
} from '../ui';
import { StatPriority } from '../../types/autogear';
import { STATS } from '../../constants';

interface StatPriorityRowProps {
    priority: StatPriority;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (priority: StatPriority) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

export const StatPriorityRow: React.FC<StatPriorityRowProps> = ({
    priority,
    isEditing,
    canMoveUp,
    canMoveDown,
    onUpdate,
    onEdit,
    onMoveUp,
    onMoveDown,
    onRemove,
}) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const hardRef = useRef<HTMLSpanElement>(null);

    const update = (changes: Partial<StatPriority>) => {
        onUpdate({ ...priority, ...changes });
    };

    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <div className="flex flex-col">
                <Button
                    aria-label="Move priority up"
                    variant="secondary"
                    size="xs"
                    onClick={onMoveUp}
                    disabled={!canMoveUp || isEditing}
                    className="!p-0.5"
                >
                    <ChevronUpIcon className="w-3 h-3" />
                </Button>
                <Button
                    aria-label="Move priority down"
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
                {STATS[priority.stat].label}
                {priority.minLimit !== undefined && (
                    <>
                        {' ('}
                        min:{' '}
                        <InlineNumberEdit
                            value={priority.minLimit}
                            onSave={(v) => update({ minLimit: v })}
                            allowEmpty
                            disabled={isEditing}
                        >
                            {priority.minLimit}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.maxLimit !== undefined && (
                    <>
                        {' ('}
                        max:{' '}
                        <InlineNumberEdit
                            value={priority.maxLimit}
                            onSave={(v) => update({ maxLimit: v })}
                            allowEmpty
                            disabled={isEditing}
                        >
                            {priority.maxLimit}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.weight !== undefined && priority.weight !== 1 && (
                    <>
                        {' ('}
                        weight:{' '}
                        <InlineNumberEdit
                            value={priority.weight}
                            onSave={(v) => update({ weight: v ?? 1 })}
                            min={0}
                            disabled={isEditing}
                        >
                            {priority.weight}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.hardRequirement && (
                    <>
                        {' '}
                        <span
                            ref={hardRef}
                            onMouseEnter={() => setShowTooltip(true)}
                            onMouseLeave={() => setShowTooltip(false)}
                            className="text-amber-400 cursor-help"
                        >
                            — Hard Requirement
                        </span>
                        <Tooltip
                            isVisible={showTooltip}
                            targetElement={hardRef.current}
                            className="bg-dark border border-dark-lighter p-2"
                        >
                            <p className="text-xs">this time it&apos;s personal</p>
                        </Tooltip>
                    </>
                )}
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit priority"
                title="Edit priority"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
            >
                <EditIcon />
            </Button>
            <Button aria-label="Remove priority" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
