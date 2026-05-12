import React, { useMemo, useRef, useState } from 'react';
import { ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
import { parseBuffEffects, isStackable, hasDpsEffect } from '../../utils/calculators/buffParser';
import { BUFFS } from '../../constants/buffs';
import { SearchInput } from '../ui/SearchInput';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

// Pre-parse all buffs at module load time
const PARSED_BUFFS = BUFFS.map((buff) => {
    const parsedEffects = parseBuffEffects(buff.name, buff.description);
    const stackInfo = isStackable(buff.description);
    return {
        ...buff,
        parsedEffects,
        isStackable: stackInfo.stackable,
        maxStacks: stackInfo.maxStacks,
    };
});

const STAT_LABELS: Record<keyof ParsedBuffEffects, string> = {
    attack: 'Atk',
    crit: 'CR',
    critDamage: 'CP',
    outgoingDamage: 'Dmg',
    defensePenetration: 'Pen',
    dotDamage: 'DoT',
    defense: 'Def',
    incomingDamage: 'Inc',
    incomingDotDamage: 'Inc.DoT',
};

function buildEffectSummary(
    effects: ParsedBuffEffects,
    stacks = 1,
    filter?: (keyof ParsedBuffEffects)[]
): string {
    const fmt = (value: number, label: string) => {
        const scaled = value * stacks;
        const sign = scaled >= 0 ? '+' : '';
        return `${sign}${scaled}% ${label}`;
    };

    const parts = (Object.keys(STAT_LABELS) as (keyof ParsedBuffEffects)[])
        .filter((k) => effects[k] !== undefined && (!filter || filter.includes(k)))
        .map((k) => fmt(effects[k] as number, STAT_LABELS[k]));

    return parts.length > 0 ? parts.join(', ') : 'No DPS effect';
}

interface GameBuffPickerProps {
    label: string;
    relevantStats: (keyof ParsedBuffEffects)[];
    value: SelectedGameBuff[];
    onChange: (buffs: SelectedGameBuff[]) => void;
}

export const GameBuffPicker: React.FC<GameBuffPickerProps> = ({
    label,
    relevantStats,
    value,
    onChange,
}) => {
    const [search, setSearch] = useState('');
    const nextIdRef = useRef(0);

    const filteredBuffs = useMemo(() => {
        const q = search.toLowerCase();
        return PARSED_BUFFS.filter(
            (buff) =>
                buff.name.toLowerCase().includes(q) || buff.description.toLowerCase().includes(q)
        );
    }, [search]);

    const handleAdd = (buff: (typeof PARSED_BUFFS)[number]) => {
        const id = String(nextIdRef.current++);
        const newEntry: SelectedGameBuff = {
            id,
            buffName: buff.name,
            stacks: 1,
            parsedEffects: buff.parsedEffects,
            isStackable: buff.isStackable,
            maxStacks: buff.maxStacks,
        };
        onChange([...value, newEntry]);
    };

    const handleRemove = (id: string) => {
        onChange(value.filter((b) => b.id !== id));
    };

    const handleStacksChange = (id: string, stacks: number) => {
        onChange(
            value.map((b) => {
                if (b.id !== id) return b;
                const min = 1;
                const max = b.maxStacks ?? Infinity;
                const clamped = Math.max(min, Math.min(max, stacks));
                return { ...b, stacks: isNaN(clamped) ? 1 : clamped };
            })
        );
    };

    return (
        <div className="space-y-2">
            <h3 className="text-sm font-medium">{label}</h3>

            <SearchInput value={search} onChange={setSearch} placeholder="Search buffs..." />

            {/* Selected buffs */}
            {value.length > 0 && (
                <div className="space-y-1">
                    {value.map((selected) => {
                        const summary = buildEffectSummary(
                            selected.parsedEffects,
                            selected.stacks,
                            relevantStats
                        );
                        return (
                            <div
                                key={selected.id}
                                className="card flex items-center gap-2 py-1 px-2"
                            >
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium truncate block">
                                        {selected.buffName}
                                    </span>
                                    <span className="text-xs text-theme-text-secondary">
                                        {summary}
                                    </span>
                                </div>

                                {selected.isStackable && (
                                    <div className="w-20 shrink-0">
                                        <Input
                                            type="number"
                                            value={selected.stacks}
                                            min={1}
                                            max={selected.maxStacks}
                                            onChange={(e) =>
                                                handleStacksChange(
                                                    selected.id,
                                                    parseInt(e.target.value, 10)
                                                )
                                            }
                                            className="text-center"
                                        />
                                    </div>
                                )}

                                <Button
                                    variant="danger"
                                    size="xs"
                                    onClick={() => handleRemove(selected.id)}
                                    aria-label={`Remove ${selected.buffName}`}
                                >
                                    ×
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Buff list */}
            <div className="overflow-y-auto max-h-72 space-y-1 border border-dark-border">
                {filteredBuffs.map((buff) => {
                    const hasDps = hasDpsEffect(buff.parsedEffects, relevantStats);
                    const summary = buildEffectSummary(buff.parsedEffects);
                    return (
                        <div
                            key={buff.name}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-dark-border"
                        >
                            <div className="flex-1 min-w-0">
                                <span
                                    className={`text-sm font-medium truncate block ${!hasDps ? 'text-theme-text-secondary' : ''}`}
                                >
                                    {buff.name}
                                </span>
                                {hasDps ? (
                                    <span className="text-xs text-theme-text-secondary">
                                        {summary}
                                    </span>
                                ) : (
                                    <span className="text-xs text-theme-text-secondary">
                                        No DPS effect
                                    </span>
                                )}
                            </div>

                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() => handleAdd(buff)}
                                aria-label={`Add ${buff.name}`}
                            >
                                +
                            </Button>
                        </div>
                    );
                })}
                {filteredBuffs.length === 0 && (
                    <p className="text-sm text-theme-text-secondary px-2 py-2">No buffs found.</p>
                )}
            </div>
        </div>
    );
};
