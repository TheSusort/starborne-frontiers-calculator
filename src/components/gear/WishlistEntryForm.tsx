import React, { useState } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { Input, Button } from '../ui';
import { GEAR_SLOT_ORDER, type GearSlotName } from '../../constants/gearTypes';
import { RARITIES, type RarityName } from '../../constants/rarities';
import { GEAR_SETS, type GearSetName } from '../../constants/gearSets';
import { STATS } from '../../constants/stats';
import IMPLANTS from '../../constants/implants';
import { StatName, StatType } from '../../types/stats';

interface Props {
    initial?: WishlistEntry;
    onSubmit: (entry: Omit<WishlistEntry, 'id'>) => void;
    onCancel?: () => void;
}

const ALL_STARS = ['1', '2', '3', '4', '5', '6'];
const ALL_RARITIES = Object.keys(RARITIES);

const implantKeys = new Set(Object.keys(IMPLANTS));
const GEAR_SET_ENTRIES = Object.entries(GEAR_SETS).filter(([key]) => !implantKeys.has(key));

const STAT_TYPE_OPTIONS: { key: string; label: string; name: StatName; type: StatType }[] =
    Object.entries(STATS).flatMap(([statName, def]) =>
        def.allowedTypes
            .filter((type) => def.maxValue[type] > 0)
            .map((type) => ({
                key: `${statName}:${type}`,
                label:
                    def.allowedTypes.length > 1
                        ? type === 'percentage'
                            ? `${def.shortLabel}%`
                            : def.shortLabel
                        : def.shortLabel,
                name: statName as StatName,
                type,
            }))
    );
const STAT_TYPE_KEYS = STAT_TYPE_OPTIONS.map(({ key }) => key);
const STAT_TYPE_KEY_LABEL: Record<string, string> = Object.fromEntries(
    STAT_TYPE_OPTIONS.map(({ key, label }) => [key, label])
);
const STAT_TYPE_KEY_PARSE: Record<string, { name: StatName; type: StatType }> = Object.fromEntries(
    STAT_TYPE_OPTIONS.map(({ key, name, type }) => [key, { name, type }])
);

function ChipPicker<T extends string>({
    label,
    allOptions,
    getLabel,
    selected,
    onToggle,
}: {
    label: string;
    allOptions: T[];
    getLabel: (v: T) => string;
    selected: T[];
    onToggle: (v: T) => void;
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-theme-text mb-2">{label}</label>
            <div className="flex flex-wrap gap-2">
                {allOptions.map((v) => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onToggle(v)}
                        className={`px-2 py-1 text-xs border transition-colors ${
                            selected.includes(v)
                                ? 'border-primary bg-primary/20 text-primary'
                                : 'border-dark-border text-theme-text-secondary hover:border-primary'
                        }`}
                    >
                        {getLabel(v)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function toggle<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export const WishlistEntryForm: React.FC<Props> = ({ initial, onSubmit, onCancel }) => {
    const [name, setName] = useState(initial?.name ?? '');
    const [slots, setSlots] = useState<GearSlotName[]>(initial?.filters.slot ?? []);
    const [stars, setStars] = useState<string[]>(initial?.filters.stars?.map(String) ?? []);
    const [rarities, setRarities] = useState<RarityName[]>(initial?.filters.rarity ?? []);
    const [setBonuses, setSetBonuses] = useState<GearSetName[]>(initial?.filters.setBonus ?? []);
    const [mainStats, setMainStats] = useState<string[]>(
        initial?.filters.mainStat?.map(
            ({ name, type }) => `${name}:${type ?? STATS[name].allowedTypes[0]}`
        ) ?? []
    );
    const [subStats, setSubStats] = useState<string[]>(
        initial?.filters.subStats?.map(
            ({ name, type }) => `${name}:${type ?? STATS[name].allowedTypes[0]}`
        ) ?? []
    );
    const [subStatsMin, setSubStatsMin] = useState<number>(
        initial?.filters.subStatsMin ?? initial?.filters.subStats?.length ?? 1
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        const filters: WishlistEntry['filters'] = {
            ...(slots.length > 0 ? { slot: slots } : {}),
            ...(stars.length > 0 ? { stars: stars.map(Number) } : {}),
            ...(rarities.length > 0 ? { rarity: rarities } : {}),
            ...(setBonuses.length > 0 ? { setBonus: setBonuses } : {}),
            ...(mainStats.length > 0
                ? { mainStat: mainStats.map((k) => STAT_TYPE_KEY_PARSE[k]) }
                : {}),
            ...(subStats.length > 0
                ? {
                      subStats: subStats.map((k) => STAT_TYPE_KEY_PARSE[k]),
                      ...(subStatsMin < subStats.length ? { subStatsMin } : {}),
                  }
                : {}),
        };
        onSubmit({ name: name.trim().slice(0, 64), filters });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
                placeholder="e.g. 6★ Legendary Attack Weapon"
            />

            <ChipPicker
                label="Stars (any of)"
                allOptions={ALL_STARS}
                getLabel={(n) => `${n}★`}
                selected={stars}
                onToggle={(n) => setStars((prev) => toggle(prev, n))}
            />

            <ChipPicker
                label="Rarity (any of)"
                allOptions={ALL_RARITIES}
                getLabel={(r) => RARITIES[r].label}
                selected={rarities}
                onToggle={(r) => setRarities((prev) => toggle(prev, r))}
            />

            <ChipPicker
                label="Slot (any of)"
                allOptions={GEAR_SLOT_ORDER}
                getLabel={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
                selected={slots}
                onToggle={(s) => setSlots((prev) => toggle(prev, s))}
            />

            <ChipPicker
                label="Gear Set (any of)"
                allOptions={GEAR_SET_ENTRIES.map(([key]) => key)}
                getLabel={(key) => GEAR_SETS[key]?.name ?? key}
                selected={setBonuses}
                onToggle={(s) => setSetBonuses((prev) => toggle(prev, s))}
            />

            <ChipPicker
                label="Main Stat (any of)"
                allOptions={STAT_TYPE_KEYS}
                getLabel={(k) => STAT_TYPE_KEY_LABEL[k] ?? k}
                selected={mainStats}
                onToggle={(k) => setMainStats((prev) => toggle(prev, k))}
            />

            <div>
                <ChipPicker
                    label="Substats"
                    allOptions={STAT_TYPE_KEYS}
                    getLabel={(k) => STAT_TYPE_KEY_LABEL[k] ?? k}
                    selected={subStats}
                    onToggle={(k) =>
                        setSubStats((prev) => {
                            const next = toggle(prev, k);
                            setSubStatsMin((m) => Math.min(m, next.length || 1));
                            return next;
                        })
                    }
                />
                {subStats.length >= 2 && (
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-theme-text-secondary">At least</span>
                        <input
                            type="number"
                            min={1}
                            max={subStats.length}
                            value={subStatsMin}
                            onChange={(e) =>
                                setSubStatsMin(
                                    Math.max(1, Math.min(subStats.length, Number(e.target.value)))
                                )
                            }
                            className="w-14 bg-dark border border-dark-border text-white text-sm px-2 py-1 text-center"
                        />
                        <span className="text-sm text-theme-text-secondary">
                            of {subStats.length} must be present
                        </span>
                    </div>
                )}
            </div>

            <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={!name.trim()}>
                    {initial ? 'Save' : 'Add Entry'}
                </Button>
                {onCancel && (
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
            </div>
        </form>
    );
};
