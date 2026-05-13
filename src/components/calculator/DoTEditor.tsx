import React from 'react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { CloseIcon } from '../ui';
import { DoTApplicationConfig, DoTApplicationEntry, DoTType } from '../../types/calculator';

const DOT_TYPE_OPTIONS = [
    { value: 'corrosion', label: 'Corrosion' },
    { value: 'inferno', label: 'Inferno' },
    { value: 'bomb', label: 'Bomb' },
];

const TIER_OPTIONS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
    corrosion: [
        { value: '3', label: 'I (3%)' },
        { value: '6', label: 'II (6%)' },
        { value: '9', label: 'III (9%)' },
    ],
    inferno: [
        { value: '15', label: 'I (15%)' },
        { value: '30', label: 'II (30%)' },
        { value: '45', label: 'III (45%)' },
    ],
    bomb: [
        { value: '100', label: 'I (100%)' },
        { value: '200', label: 'II (200%)' },
        { value: '300', label: 'III (300%)' },
    ],
};

interface DoTEditorProps {
    dots: DoTApplicationConfig;
    label: string;
    labelClassName: string;
    onAdd: () => void;
    onRemove: (dotId: string) => void;
    onUpdate: (dotId: string, updates: Partial<DoTApplicationEntry>) => void;
}

export const DoTEditor: React.FC<DoTEditorProps> = ({
    dots,
    label,
    labelClassName,
    onAdd,
    onRemove,
    onUpdate,
}) => (
    <>
        <div className="flex justify-between items-center mb-2">
            <div className={`text-xs font-semibold uppercase tracking-wide ${labelClassName}`}>
                {label}
            </div>
            <Button variant="secondary" size="xs" onClick={onAdd}>
                Add DoT
            </Button>
        </div>
        {dots.length === 0 ? (
            <p className="text-sm text-theme-text-secondary mb-4">No DoTs configured</p>
        ) : (
            <div className="space-y-2 mb-4">
                {dots.map((dot) => (
                    <div key={dot.id} className="flex items-end gap-2">
                        <Select
                            label="Type"
                            options={DOT_TYPE_OPTIONS}
                            value={dot.type}
                            onChange={(v) => {
                                const newType = v as DoTType;
                                const firstTier = parseInt(TIER_OPTIONS_BY_TYPE[newType][0].value);
                                onUpdate(dot.id, { type: newType, tier: firstTier, duration: 2 });
                            }}
                        />
                        <Select
                            label="Tier"
                            options={TIER_OPTIONS_BY_TYPE[dot.type] || []}
                            value={String(dot.tier)}
                            onChange={(v) => onUpdate(dot.id, { tier: parseInt(v) })}
                        />
                        <Input
                            label="Stacks"
                            type="number"
                            min="0"
                            value={dot.stacks}
                            onChange={(e) =>
                                onUpdate(dot.id, { stacks: parseInt(e.target.value) || 0 })
                            }
                            className="w-20"
                        />
                        <Input
                            label={dot.type === 'bomb' ? 'Countdown' : 'Duration'}
                            type="number"
                            min="1"
                            value={dot.duration}
                            onChange={(e) =>
                                onUpdate(dot.id, {
                                    duration: Math.max(1, parseInt(e.target.value) || 1),
                                })
                            }
                            className="w-20"
                        />
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onRemove(dot.id)}
                            aria-label="Remove DoT"
                        >
                            <CloseIcon />
                        </Button>
                    </div>
                ))}
            </div>
        )}
    </>
);
