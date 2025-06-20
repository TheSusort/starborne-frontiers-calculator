import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    const isInitialMount = useRef(true);

    useEffect(() => {
        if (editingPiece) {
            setSlot(editingPiece.slot);
            setMainStat(
                editingPiece.mainStat || ({ name: 'attack', value: 0, type: 'flat' } as Stat)
            );
            setSubStats(editingPiece.subStats);
            setRarity(editingPiece.rarity);
            setStars(editingPiece.stars);
            setSetBonus(editingPiece.setBonus || 'FORTITUDE');
            setLevel(editingPiece.level);
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

    // Separate effect for value calculations
    useEffect(() => {
        if (!editingPiece && !isInitialMount.current) {
            const calculatedValue = calculateMainStatValue(
                mainStat.name,
                mainStat.type,
                stars,
                level
            );
            if (calculatedValue !== mainStat.value) {
                setMainStat((prev) => ({
                    ...prev,
                    value: calculatedValue,
                }));
            }
        }
    }, [stars, level, mainStat.name, mainStat.type, mainStat.value, editingPiece]);

    // Add isInitialMount ref to prevent first render calculation
    useEffect(() => {
        isInitialMount.current = false;
    }, []);

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
                    type: allowedTypes[0] as StatType,
                };
            }

            return subStat;
        });

        const piece = {
            id: editingPiece?.id,
            slot,
            mainStat,
            subStats: validatedSubStats as Stat[], // Use validated substats
            setBonus,
            stars,
            rarity,
            level,
            shipId: editingPiece?.shipId || '',
        };
        await onSubmit(piece as GearPiece);
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
        <form onSubmit={handleSubmit} className="space-y-6  bg-dark p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Select
                    label="Set Bonus"
                    value={setBonus}
                    onChange={(value) => setSetBonus(value as GearSetName)}
                    options={setOptions}
                />

                <Select
                    label="Slot"
                    value={slot}
                    onChange={(value) => setSlot(value as GearSlotName)}
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
                    onChange={(e) => setLevel(Math.min(16, Math.max(0, Number(e.target.value))))}
                />

                <Select
                    label="Rarity"
                    value={rarity}
                    onChange={(value) => setRarity(value as RarityName)}
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
                            label: STATS[stat as StatName].label,
                        }))}
                        data-testid="main-stat-select"
                    />
                    <Input
                        label="Main Stat Value"
                        type="number"
                        value={mainStat.value}
                        onChange={(e) => handleMainStatChange({ value: Number(e.target.value) })}
                        className="w-32"
                        labelClassName="invisible"
                    />
                    {(slot === 'sensor' || slot === 'software' || slot === 'thrusters') && (
                        <Select
                            value={mainStat.type}
                            onChange={(value) => handleMainStatChange({ type: value as StatType })}
                            options={getAvailableStatTypes(mainStat.name).map((type) => ({
                                value: type,
                                label: type.charAt(0).toUpperCase() + type.slice(1),
                            }))}
                            className="w-32"
                        />
                    )}
                </div>
            </div>

            {/* Sub Stats Section */}
            <div className="space-y-4">
                <h4 className="text-sm font-medium ">Sub Stats</h4>
                <StatModifierInput
                    stats={subStats}
                    onChange={setSubStats}
                    maxStats={4}
                    excludedStats={[{ name: mainStat.name, type: mainStat.type }]}
                />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
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
