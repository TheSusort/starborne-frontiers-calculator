import React from 'react';
import { Select } from '../ui/Select';
import type { Position } from '../../types/encounters';
import { HEALING_SLOT_OPTIONS } from '../../utils/calculators/healingPlacement';

interface Props {
    value: Position;
    onChange: (position: Position) => void;
    label?: string;
    /** Slots already occupied by OTHER actors on the same side — annotated, not disabled, so the
     *  user can still pick one and let `resolvePlayerSlots`/`resolveEnemySlots` shuffle. */
    taken?: readonly Position[];
    helpLabel?: string;
}

/** Column 4 is the FRONT of the board — annotate it so placement reads correctly without a board. */
const slotLabel = (p: Position, taken: readonly Position[], value: Position): string => {
    if (p !== value && taken.includes(p)) return `${p} (taken)`;
    return p.endsWith('4') ? `${p} (front)` : p;
};

export const SlotSelect: React.FC<Props> = ({
    value,
    onChange,
    label = 'Board slot',
    taken = [],
    helpLabel,
}) => (
    <Select
        label={label}
        helpLabel={helpLabel}
        value={value}
        onChange={(v) => onChange(v as Position)}
        options={HEALING_SLOT_OPTIONS.map((p) => ({
            value: p,
            label: slotLabel(p, taken, value),
        }))}
        className="w-full"
    />
);
