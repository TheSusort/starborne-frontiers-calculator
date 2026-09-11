import React from 'react';
import { Modal } from '../ui/layout/Modal';
import { Button } from '../ui/Button';
import { InlineNumberEdit } from '../ui/InlineNumberEdit';
import { STATS } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import type { Position } from '../../types/encounters';
import {
    OVERRIDABLE_STATS,
    OVERRIDE_MIN,
    normalizeOverride,
    type OverridableStat,
    type ResolvedCombatStats,
    type StatOverrides,
} from '../../utils/simulator/statOverrides';

interface StatOverrideModalProps {
    isOpen: boolean;
    onClose: () => void;
    shipName: string;
    position: Position;
    base: ResolvedCombatStats;
    overrides?: StatOverrides;
    onChange: (next: StatOverrides) => void;
}

const labelFor = (stat: OverridableStat) => STATS[stat as StatName].label;

/** One placement's stat editor: every overridable stat as an absolute value, prefilled from its
 *  resolved (gear + refits + engineering) figure. Edits are held in `overrides` on the placement,
 *  never written back to the ship, so closing the modal without changes leaves gear untouched. */
const StatOverrideModal: React.FC<StatOverrideModalProps> = ({
    isOpen,
    onClose,
    shipName,
    position,
    base,
    overrides,
    onChange,
}) => {
    const handleSave = (stat: OverridableStat, value: number | undefined) => {
        const normalized = normalizeOverride(stat, value, base[stat]);
        const next: StatOverrides = { ...overrides };
        if (normalized === undefined) delete next[stat];
        else next[stat] = normalized;
        onChange(next);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`${shipName} — ${position}`}>
            <div className="space-y-1">
                {OVERRIDABLE_STATS.map((stat) => {
                    const baseValue = base[stat];
                    const overrideValue = overrides?.[stat];
                    const effective = overrideValue ?? baseValue;
                    const delta =
                        overrideValue !== undefined ? overrideValue - baseValue : undefined;
                    const label = labelFor(stat);

                    return (
                        <div
                            key={stat}
                            className="flex items-center justify-between gap-3 py-2 border-b border-dark-border last:border-0"
                        >
                            <div className="flex flex-col">
                                <span className="text-sm text-theme-text">{label}</span>
                                <span className="text-xs text-theme-text-secondary">
                                    Base {baseValue}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {delta !== undefined && (
                                    <span
                                        className={`text-xs font-semibold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                                    >
                                        {delta > 0 ? `+${delta}` : delta}
                                    </span>
                                )}
                                <InlineNumberEdit
                                    value={effective}
                                    min={OVERRIDE_MIN[stat] ?? 0}
                                    label={`${label} for ${shipName}`}
                                    onSave={(value) => handleSave(stat, value)}
                                >
                                    {effective}
                                </InlineNumberEdit>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between items-center pt-4 mt-2 border-t border-dark-border">
                <Button variant="secondary" onClick={() => onChange({})}>
                    Reset all
                </Button>
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            </div>
        </Modal>
    );
};

export default StatOverrideModal;
