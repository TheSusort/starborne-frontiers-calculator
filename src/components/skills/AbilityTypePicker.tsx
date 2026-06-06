import React from 'react';
import { AbilityType } from '../../types/abilities';
import { Button } from '../ui/Button';
import { NOT_SIMULATED_NOTE } from './simCoverage';

interface Props {
    onPick: (type: AbilityType) => void;
}

const TYPE_LABELS: Record<AbilityType, string> = {
    damage: 'Damage',
    'additional-damage': 'Additional Damage',
    modifier: 'Modifier',
    buff: 'Buff',
    debuff: 'Debuff',
    dot: 'DoT',
    'extend-dot': 'Extend DoTs',
    'detonate-dot': 'Detonate DoTs',
    'accumulate-detonate': 'Accumulate & Detonate',
    charge: 'Charge',
    'extra-action': 'Extra Action',
    heal: 'Heal',
    shield: 'Shield',
    cleanse: 'Cleanse',
    purge: 'Purge',
    control: 'Control',
};

const CATEGORIES: { label: string; types: AbilityType[]; note?: string }[] = [
    { label: 'Damage', types: ['damage', 'additional-damage'] },
    {
        label: 'Modify',
        types: [
            'modifier',
            'buff',
            'debuff',
            'dot',
            'extend-dot',
            'detonate-dot',
            'accumulate-detonate',
        ],
    },
    { label: 'Charge & Turns', types: ['charge', 'extra-action'] },
    {
        label: 'Utility',
        types: ['heal', 'shield', 'cleanse', 'purge', 'control'],
        note: NOT_SIMULATED_NOTE,
    },
];

export const AbilityTypePicker: React.FC<Props> = ({ onPick }) => (
    <div className="space-y-3">
        {CATEGORIES.map((category) => (
            <div key={category.label} className="card space-y-2">
                <span className="text-xs font-semibold uppercase text-theme-text-secondary">
                    {category.label}
                </span>
                {category.note && (
                    <p className="text-xs text-theme-text-secondary">{category.note}</p>
                )}
                <div className="flex flex-wrap gap-2">
                    {category.types.map((type) => (
                        <Button
                            key={type}
                            variant="secondary"
                            size="sm"
                            onClick={() => onPick(type)}
                        >
                            {TYPE_LABELS[type]}
                        </Button>
                    ))}
                </div>
            </div>
        ))}
    </div>
);
