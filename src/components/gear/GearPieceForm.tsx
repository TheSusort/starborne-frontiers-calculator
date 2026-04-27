import React, { useState, useEffect, useCallback } from 'react';
import { GearPiece } from '../../types/gear';
import { StatName, StatType, Stat } from '../../types/stats';
import {
    GearSetName,
    GEAR_SETS,
    RARITIES,
    RarityName,
    GEAR_SLOTS,
    GearSlotName,
    STATS,
    SLOT_MAIN_STATS,
} from '../../constants';
import { Button, Input, Select } from '../ui';
import { StatModifierInput } from '../stats/StatModifierInput';
import { calculateMainStatValue } from '../../utils/gear/mainStatValueFetcher';
import { getMaxSubstatsForLevel } from '../../utils/gear/potentialCalculator';

interface Props {
    onSubmit: (piece: GearPiece) => void;
    editingPiece?: GearPiece;
}

export const GearPieceForm: React.FC<Props> = ({ onSubmit, editingPiece }) => {
    const [slot, setSlot] = useState<GearSlotName>(editingPiece?.slot || 'weapon');
    const [mainStat, setMainStat] = useState<Stat>(
        editingPiece?.mainStat || ({ name: 'attack', value: 0, type: 'flat' } as Stat)
    );
    const [subStats, setSubStats] = useState<Stat[]>(editingPiece?.subStats || []);
    const [rarity, setRarity] = useState<RarityName>(editingPiece?.rarity || 'rare');
    const [stars, setStars] = useState<number>(editingPiece?.stars || 1);
    const [setBonus, setSetBonus] = useState<GearSetName>(editingPiece?.setBonus || 'FORTITUDE');
    const [level, setLevel] = useState<number>(editingPiece?.level || 0);
    const [showAllFields, setShowAllFields] = useState(false);

    useEffect(() => {
        if (editingPiece) {
            setShowAllFields(false);
            setSlot(editingPiece.slot);
            setMainStat(
                editingPiece.mainStat || ({ name: 'attack', value: 0, type: 'flat' } as Stat)
            );
            setSubStats(editingPiece.subStats);
            setRarity(editingPiece.rarity);
            setStars(editingPiece.stars);
            setSetBonus(editingPiece.setBonus || 'FORTITUDE');
            setLevel(editingPiece.level);
        } else {
            setShowAllFields(false);
            setSlot('weapon');
            setMainStat({ name: 'attack', value: 0, type: 'flat' } as Stat);
            setSubStats([]);
            setRarity('rare');
            setStars(1);
            setSetBonus('FORTITUDE');
            setLevel(0);
        }
    }, [editingPiece]);

    // Remove getAvailableMainStats function and use SLOT_MAIN_STATS instead
    const getAvailableMainStats = (slot: GearSlotName): StatName[] => {
        return SLOT_MAIN_STATS[slot];
    };

    // Remove getAvailableStatTypes function and use STATS instead
    const getAvailableStatTypes = (statName: StatName): StatType[] => {
        return STATS[statName].allowedTypes;
    };

    // Separate effect for slot changes
    useEffect(() => {
        if (!editingPiece) {
            const availableStats = getAvailableMainStats(slot);
            if (!availableStats.includes(mainStat.name)) {
                setMainStat({ name: availableStats[0], value: 0, type: 'flat' } as Stat);
            }
        }
    }, [slot, editingPiece, mainStat.name, mainStat.value]);

    useEffect(() => {
        const calculatedValue = calculateMainStatValue(mainStat.name, mainStat.type, stars, level);
        if (calculatedValue !== mainStat.value) {
            setMainStat((prev) => ({
                ...prev,
                value: calculatedValue,
            }));
        }
    }, [stars, level, mainStat.name, mainStat.type, mainStat.value]);

    // Auto-add one empty substat slot when editing in compact mode and a slot is available.
    useEffect(() => {
        if (!editingPiece || showAllFields) return;
        const max = getMaxSubstatsForLevel(rarity, level);
        const existingCount = editingPiece.subStats.length;
        setSubStats((prev) => {
            if (prev.length >= max) return prev;
            // Don't add a second pending slot if one already exists
            if (prev.slice(existingCount).some((s) => s.value === 0)) return prev;
            const firstStat = Object.keys(STATS)[0] as StatName;
            return [
                ...prev,
                { name: firstStat, value: 0, type: STATS[firstStat].allowedTypes[0] } as Stat,
            ];
        });
    }, [editingPiece, showAllFields, level, rarity]);

    const handleMainStatChange = useCallback(
        (changes: Partial<Pick<Stat, 'value' | 'name'>> & { type?: StatType }) => {
            if (changes.name) {
                const allowedTypes = STATS[changes.name].allowedTypes;
                changes.type = allowedTypes.includes(mainStat.type)
                    ? mainStat.type
                    : allowedTypes[0];
            }

            if (changes.value !== undefined) {
                const statConfig = STATS[changes.name || mainStat.name];
                const type = changes.type || mainStat.type;
                changes.value = Math.min(changes.value, statConfig.maxValue[type]);
            }

            setMainStat(
                (prev) =>
                    ({
                        ...prev,
                        ...changes,
                    }) as Stat
            );
        },
        [mainStat.type, mainStat.name] // Reduced dependencies
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate and adjust substat types
        const validatedSubStats = subStats.map((subStat) => {
            if (subStat.name === mainStat.name) {
                return {
                    ...subStat,
                    type: (mainStat.type === 'flat' ? 'percentage' : 'flat') as StatType,
                };
            }

            const allowedTypes = STATS[subStat.name].allowedTypes;
            if (!allowedTypes.includes(subStat.type)) {
                return {
                    ...subStat,
                    type: allowedTypes[0],
                };
            }

            return subStat;
        });

        // Drop any zero-value substats that were auto-added but never filled in
        const existingSubstatCount = editingPiece?.subStats.length ?? 0;
        const filteredSubStats = validatedSubStats.filter(
            (s, i) => i < existingSubstatCount || s.value !== 0
        );

        const piece = {
            id: editingPiece?.id,
            slot,
            mainStat,
            subStats: filteredSubStats as Stat[],
            setBonus,
            stars,
            rarity,
            level,
            shipId: editingPiece?.shipId || '',
            calibration: editingPiece?.calibration,
        };
        onSubmit(piece as GearPiece);
        setSubStats([]);
        setStars(1);
        setLevel(0);
        setSlot('weapon');
        setMainStat({ name: 'attack', value: 0, type: 'flat' } as Stat);
        setRarity('rare');
        setSetBonus('FORTITUDE');
    };

    const setOptions = Object.entries(GEAR_SETS).map(([key, set]) => ({
        value: key,
        label: set.name,
    }));

    const rarityOptions = Object.entries(RARITIES).map(([key, rarity]) => ({
        value: key,
        label: rarity.label,
    }));

    const gearTypeOptions = Object.entries(GEAR_SLOTS).map(([key, slot]) => ({
        value: key,
        label: slot.label,
    }));

    return (
        <form
            onSubmit={(e) => void handleSubmit(e)}
            className={`bg-dark border p-4 ${RARITIES[rarity].borderColor} ${editingPiece && !showAllFields ? 'space-y-4 max-w-[400px] mx-auto w-full' : 'space-y-6'}`}
        >
            {editingPiece && !showAllFields ? (
                <>
                    {/* Card-style header — flush to the form border edges */}
                    <div
                        className={`-mx-4 -mt-4 px-4 py-3 border-b ${RARITIES[rarity].borderColor} flex justify-between items-start`}
                    >
                        <div>
                            <div className="flex items-center gap-2">
                                {GEAR_SETS[setBonus]?.iconUrl && (
                                    <img
                                        src={GEAR_SETS[setBonus].iconUrl}
                                        alt={GEAR_SETS[setBonus].name}
                                        className="w-5"
                                    />
                                )}
                                <span className="font-secondary text-sm">
                                    {GEAR_SETS[setBonus]?.name} {GEAR_SLOTS[slot].label}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-sm mt-1.5">
                                <span className="text-yellow-400">★ {stars}</span>
                                <span className="text-theme-text-secondary flex items-center gap-1.5">
                                    Lvl
                                    <div className="w-14 shrink-0">
                                        <Input
                                            type="number"
                                            value={level}
                                            min={0}
                                            max={16}
                                            className="!h-6 !py-0 !px-1 text-sm text-center"
                                            onChange={(e) =>
                                                setLevel(
                                                    Math.min(
                                                        16,
                                                        Math.max(0, Number(e.target.value))
                                                    )
                                                )
                                            }
                                        />
                                    </div>
                                </span>
                            </div>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => setShowAllFields(true)}
                        >
                            Full Edit
                        </Button>
                    </div>

                    {/* Main stat — card body style */}
                    <div>
                        <div className="text-xs text-theme-text-secondary mb-1.5">Main Stat</div>
                        <div className="flex justify-between items-center text-sm bg-dark-lighter px-3 py-2">
                            <span>{STATS[mainStat.name].label}</span>
                            <span className="font-medium">
                                {mainStat.value}
                                {mainStat.type === 'percentage' ? '%' : ''}
                            </span>
                        </div>
                    </div>
                </>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Select
                        label="Set Bonus"
                        value={setBonus}
                        onChange={(value) => setSetBonus(value)}
                        options={setOptions}
                    />

                    <Select
                        label="Slot"
                        value={slot}
                        onChange={(value) => setSlot(value)}
                        options={gearTypeOptions}
                    />

                    <Select
                        label="Stars"
                        value={stars.toString()}
                        onChange={(value) => setStars(Number(value))}
                        options={[1, 2, 3, 4, 5, 6].map((num) => ({
                            value: num.toString(),
                            label: `${num} ⭐`,
                        }))}
                    />

                    <Input
                        type="number"
                        label="Level"
                        value={level}
                        min={0}
                        max={16}
                        onChange={(e) =>
                            setLevel(Math.min(16, Math.max(0, Number(e.target.value))))
                        }
                    />

                    <Select
                        label="Rarity"
                        value={rarity}
                        onChange={(value) => setRarity(value)}
                        options={rarityOptions}
                    />

                    {/* Main Stat Section */}
                    <div className="grid grid-cols-2 gap-4">
                        <Select
                            label="Main Stat"
                            value={mainStat.name}
                            onChange={(value) => handleMainStatChange({ name: value as StatName })}
                            options={getAvailableMainStats(slot).map((stat) => ({
                                value: stat,
                                label: STATS[stat].label,
                            }))}
                            data-testid="main-stat-select"
                        />
                        <Input
                            label="Main Stat Value"
                            type="number"
                            value={mainStat.value}
                            onChange={(e) =>
                                handleMainStatChange({ value: Number(e.target.value) })
                            }
                            className="w-32"
                            labelClassName="invisible"
                        />
                        {(slot === 'sensor' || slot === 'software' || slot === 'thrusters') && (
                            <Select
                                value={mainStat.type}
                                onChange={(value) =>
                                    handleMainStatChange({ type: value as StatType })
                                }
                                options={getAvailableStatTypes(mainStat.name).map((type) => ({
                                    value: type,
                                    label: type.charAt(0).toUpperCase() + type.slice(1),
                                }))}
                                className="w-32"
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Sub Stats Section */}
            <div className="space-y-2">
                <h4
                    className={
                        editingPiece && !showAllFields
                            ? 'text-xs text-theme-text-secondary'
                            : 'text-sm font-medium'
                    }
                >
                    Sub Stats
                </h4>
                <StatModifierInput
                    stats={subStats}
                    onChange={setSubStats}
                    maxStats={
                        editingPiece && !showAllFields ? getMaxSubstatsForLevel(rarity, level) : 4
                    }
                    excludedStats={[{ name: mainStat.name, type: mainStat.type }]}
                    existingCount={
                        editingPiece && !showAllFields ? editingPiece.subStats.length : undefined
                    }
                    compact={editingPiece !== undefined && !showAllFields}
                />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
                <Button
                    aria-label={editingPiece ? 'Save gear piece' : 'Add gear piece'}
                    type="submit"
                >
                    {editingPiece ? 'Save Gear Piece' : 'Add Gear Piece'}
                </Button>
            </div>
        </form>
    );
};
