import React, { useState } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { Input, Select, Button } from '../ui';
import { GEAR_SLOT_ORDER, GEAR_SLOTS, type GearSlotName } from '../../constants/gearTypes';
import { RARITIES, type RarityName } from '../../constants/rarities';
import { GEAR_SETS, type GearSetName } from '../../constants/gearSets';
import { STATS } from '../../constants/stats';
import IMPLANTS from '../../constants/implants';
import { StatName } from '../../types/stats';

interface Props {
    initial?: WishlistEntry;
    onSubmit: (entry: Omit<WishlistEntry, 'id'>) => void;
    onCancel?: () => void;
}

const SLOT_OPTIONS = [
    { value: '', label: 'Any slot' },
    ...GEAR_SLOT_ORDER.map((slot) => ({
        value: slot,
        label: slot.charAt(0).toUpperCase() + slot.slice(1),
    })),
];

const STAR_OPTIONS = [
    { value: '', label: 'Any stars' },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n}★+` })),
];

const RARITY_OPTIONS = [
    { value: '', label: 'Any rarity' },
    ...Object.entries(RARITIES).map(([key, r]) => ({ value: key, label: r.label })),
];

// Exclude implant-specific sets (keys that exist in IMPLANTS)
const implantKeys = new Set(Object.keys(IMPLANTS));
const GEAR_SET_OPTIONS = [
    { value: '', label: 'Any set' },
    ...Object.entries(GEAR_SETS)
        .filter(([key]) => !implantKeys.has(key))
        .map(([key, gs]) => ({ value: key, label: gs.name })),
];

const MAIN_STAT_OPTIONS = [
    { value: '', label: 'Any main stat' },
    ...Object.entries(STATS).map(([key, s]) => ({ value: key, label: s.label })),
];

const ALL_STAT_NAMES = Object.keys(STATS) as StatName[];

// Type guards for select field values
const isGearSlotName = (value: string): value is GearSlotName =>
    value === '' || Object.keys(GEAR_SLOTS).includes(value);
const isRarityName = (value: string): value is RarityName =>
    value === '' || Object.keys(RARITIES).includes(value);
const isGearSetName = (value: string): value is GearSetName =>
    value === '' || Object.keys(GEAR_SETS).includes(value);

export const WishlistEntryForm: React.FC<Props> = ({ initial, onSubmit, onCancel }) => {
    const [name, setName] = useState(initial?.name ?? '');
    const [slot, setSlot] = useState(initial?.filters.slot ?? '');
    const [stars, setStars] = useState(
        initial?.filters.stars !== undefined ? String(initial.filters.stars) : ''
    );
    const [rarity, setRarity] = useState(initial?.filters.rarity ?? '');
    const [setBonus, setSetBonus] = useState(initial?.filters.setBonus ?? '');
    const [mainStat, setMainStat] = useState(initial?.filters.mainStat?.name ?? '');
    const [subStats, setSubStats] = useState<StatName[]>(
        initial?.filters.subStats?.map((s) => s.name) ?? []
    );

    const toggleSubStat = (statName: StatName) => {
        setSubStats((prev) =>
            prev.includes(statName) ? prev.filter((s) => s !== statName) : [...prev, statName]
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        const filters: WishlistEntry['filters'] = {
            ...(slot && isGearSlotName(slot) ? { slot } : {}),
            ...(stars ? { stars: Number(stars) } : {}),
            ...(rarity && isRarityName(rarity) ? { rarity } : {}),
            ...(setBonus && isGearSetName(setBonus) ? { setBonus } : {}),
            ...(mainStat ? { mainStat: { name: mainStat as StatName } } : {}),
            ...(subStats.length > 0 ? { subStats: subStats.map((n) => ({ name: n })) } : {}),
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select label="Slot" value={slot} onChange={setSlot} options={SLOT_OPTIONS} />
                <Select
                    label="Min Stars"
                    value={stars}
                    onChange={setStars}
                    options={STAR_OPTIONS}
                />
                <Select
                    label="Rarity"
                    value={rarity}
                    onChange={setRarity}
                    options={RARITY_OPTIONS}
                />
                <Select
                    label="Gear Set"
                    value={setBonus}
                    onChange={setSetBonus}
                    options={GEAR_SET_OPTIONS}
                />
                <Select
                    label="Main Stat"
                    value={mainStat}
                    onChange={setMainStat}
                    options={MAIN_STAT_OPTIONS}
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-theme-text mb-2">
                    Required Substats
                </label>
                <div className="flex flex-wrap gap-2">
                    {ALL_STAT_NAMES.map((statName) => (
                        <button
                            key={statName}
                            type="button"
                            onClick={() => toggleSubStat(statName)}
                            className={`px-2 py-1 text-xs border transition-colors ${
                                subStats.includes(statName)
                                    ? 'border-primary bg-primary/20 text-primary'
                                    : 'border-dark-border text-theme-text-secondary hover:border-primary'
                            }`}
                        >
                            {STATS[statName]?.shortLabel ?? statName}
                        </button>
                    ))}
                </div>
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
