import React, { useMemo, useState } from 'react';
import { ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
import { parseBuffEffects, isStackable, hasDpsEffect } from '../../utils/calculators/buffParser';
import { BUFFS } from '../../constants/buffs';
import { SearchInput } from '../ui/SearchInput';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Dropdown } from '../ui/Dropdown';
import { CheckIcon } from '../ui/icons/CheckIcon';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';

const PARSED_BUFFS = BUFFS.map((buff) => {
    const parsedEffects = parseBuffEffects(buff.name, buff.description);
    const stackInfo = isStackable(buff.description);
    return {
        ...buff,
        parsedEffects,
        isStackable: stackInfo.stackable,
        maxStacks: stackInfo.maxStacks,
    };
}).sort((a, b) => a.name.localeCompare(b.name));

const STAT_LABELS: Record<keyof ParsedBuffEffects, string> = {
    attack: 'Atk',
    crit: 'CR',
    critDamage: 'CP',
    outgoingDamage: 'Dmg',
    defensePenetration: 'Pen',
    dotDamage: 'DoT',
    outgoingHeal: 'Out.Repair',
    incomingHeal: 'Inc.Repair',
    defense: 'Def',
    incomingDamage: 'Inc',
    incomingDotDamage: 'Inc.DoT',
    security: 'Sec',
    speed: 'Speed',
};

// Stats stored as flat values, not percentages
const FLAT_STATS = new Set<keyof ParsedBuffEffects>(['security']);

function buildEffectSummary(
    effects: ParsedBuffEffects,
    stacks = 1,
    filter?: (keyof ParsedBuffEffects)[]
): string {
    const fmt = (key: keyof ParsedBuffEffects, value: number, label: string) => {
        const scaled = value * stacks;
        const sign = scaled >= 0 ? '+' : '';
        const suffix = FLAT_STATS.has(key) ? '' : '%';
        return `${sign}${scaled}${suffix} ${label}`;
    };

    const parts = (Object.keys(STAT_LABELS) as (keyof ParsedBuffEffects)[])
        .filter((k) => effects[k] !== undefined && (!filter || filter.includes(k)))
        .map((k) => fmt(k, effects[k] as number, STAT_LABELS[k]));

    return parts.length > 0 ? parts.join(', ') : 'No DPS effect';
}

interface GameBuffPickerProps {
    label: string;
    relevantStats: (keyof ParsedBuffEffects)[];
    value: SelectedGameBuff[];
    onChange: (buffs: SelectedGameBuff[]) => void;
    excludeTypes?: ('buff' | 'debuff' | 'effect')[];
}

export const GameBuffPicker: React.FC<GameBuffPickerProps> = ({
    label,
    relevantStats,
    value,
    onChange,
    excludeTypes,
}) => {
    const [search, setSearch] = useState('');

    const { relevantBuffs, otherBuffs } = useMemo(() => {
        const q = search.toLowerCase();
        const all = PARSED_BUFFS.filter(
            (buff) =>
                (!excludeTypes || !excludeTypes.includes(buff.type)) &&
                (buff.name.toLowerCase().includes(q) || buff.description.toLowerCase().includes(q))
        );
        return {
            relevantBuffs: all.filter((b) => hasDpsEffect(b.parsedEffects, relevantStats)),
            otherBuffs: all.filter((b) => !hasDpsEffect(b.parsedEffects, relevantStats)),
        };
    }, [search, excludeTypes, relevantStats]);

    const selectedNames = useMemo(() => new Set(value.map((s) => s.buffName)), [value]);

    const toggleBuff = (buff: (typeof PARSED_BUFFS)[number]) => {
        if (selectedNames.has(buff.name)) {
            onChange(value.filter((s) => s.buffName !== buff.name));
        } else {
            const family = buff.name.replace(/\s+[IVX]+$/, '');
            const withoutFamily = value.filter(
                (s) => s.buffName.replace(/\s+[IVX]+$/, '') !== family
            );
            onChange([
                ...withoutFamily,
                {
                    id: buff.name,
                    buffName: buff.name,
                    stacks: 1,
                    parsedEffects: buff.parsedEffects,
                    isStackable: buff.isStackable,
                    maxStacks: buff.maxStacks,
                },
            ]);
        }
    };

    const handleStacksChange = (id: string, stacks: number) => {
        onChange(
            value.map((b) => {
                if (b.id !== id) return b;
                const max = b.maxStacks ?? Infinity;
                const clamped = Math.max(1, Math.min(max, stacks));
                return { ...b, stacks: isNaN(clamped) ? 1 : clamped };
            })
        );
    };

    const triggerLabel =
        value.length > 0 ? `${label} (${value.length} selected)` : `Select ${label}…`;

    return (
        <div className="space-y-2">
            <Dropdown
                align="left"
                trigger={(isOpen) => (
                    <div className="flex cursor-pointer items-center justify-between border border-dark-border bg-dark px-3 py-2 hover:border-primary">
                        <span className="text-sm">{triggerLabel}</span>
                        <ChevronDownIcon
                            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        />
                    </div>
                )}
            >
                <div className="w-72 p-2">
                    <SearchInput value={search} onChange={setSearch} placeholder="Search buffs…" />
                    <div className="mt-2 max-h-64 overflow-y-auto">
                        {relevantBuffs.length === 0 && otherBuffs.length === 0 && (
                            <p className="px-2 py-2 text-sm text-theme-text-secondary">
                                No buffs found.
                            </p>
                        )}
                        {relevantBuffs.length > 0 && (
                            <>
                                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
                                    Relevant
                                </p>
                                {relevantBuffs.map((buff) => {
                                    const isSelected = selectedNames.has(buff.name);
                                    const summary = buildEffectSummary(
                                        buff.parsedEffects,
                                        1,
                                        relevantStats
                                    );
                                    return (
                                        <button
                                            key={buff.name}
                                            type="button"
                                            onClick={() => toggleBuff(buff)}
                                            className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-dark-border ${isSelected ? 'bg-dark-lighter' : ''}`}
                                        >
                                            <div
                                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                                                    isSelected
                                                        ? 'border-primary bg-primary'
                                                        : 'border-dark-border bg-dark'
                                                }`}
                                            >
                                                <CheckIcon
                                                    className={`!h-3 !w-3 text-dark transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="block truncate text-sm">
                                                    {buff.name}
                                                </span>
                                                <span className="text-xs text-theme-text-secondary">
                                                    {summary}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        )}
                        {otherBuffs.length > 0 && (
                            <>
                                {relevantBuffs.length > 0 && (
                                    <div className="my-1 border-t border-dark-border" />
                                )}
                                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
                                    Other
                                </p>
                                {otherBuffs.map((buff) => {
                                    const isSelected = selectedNames.has(buff.name);
                                    return (
                                        <button
                                            key={buff.name}
                                            type="button"
                                            onClick={() => toggleBuff(buff)}
                                            className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-dark-border ${isSelected ? 'bg-dark-lighter' : ''}`}
                                        >
                                            <div
                                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                                                    isSelected
                                                        ? 'border-primary bg-primary'
                                                        : 'border-dark-border bg-dark'
                                                }`}
                                            >
                                                <CheckIcon
                                                    className={`!h-3 !w-3 text-dark transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="block truncate text-sm text-theme-text-secondary">
                                                    {buff.name}
                                                </span>
                                                <span className="text-xs text-theme-text-secondary">
                                                    No effect
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>
            </Dropdown>

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
                                className="card flex items-center gap-2 px-2 py-1"
                            >
                                <div className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">
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
                                    size="sm"
                                    onClick={() =>
                                        onChange(value.filter((b) => b.id !== selected.id))
                                    }
                                    aria-label={`Remove ${selected.buffName}`}
                                >
                                    ×
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
