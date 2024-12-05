import React, { useState, useEffect } from 'react';
import { GearPiece, Stat, StatName, StatType } from '../types/gear';
import { GearSetName, GEAR_SETS, RARITIES, RarityName, GEAR_SLOTS, GearSlotName } from '../constants';
import { Button, Input, Select } from './ui';

interface Props {
    onSubmit: (piece: GearPiece) => void;
    editingPiece?: GearPiece;
}

export const GearPieceForm: React.FC<Props> = ({ onSubmit, editingPiece }) => {
    const [slot, setSlot] = useState<GearSlotName>(editingPiece?.slot || 'weapon');
    const [mainStat, setMainStat] = useState<Stat>(editingPiece?.mainStat || { name: 'attack', value: 0, type: 'flat' } as Stat);
    const [subStats, setSubStats] = useState<Stat[]>(editingPiece?.subStats || []);
    const [rarity, setRarity] = useState<RarityName>(editingPiece?.rarity || 'rare');
    const [stars, setStars] = useState<number>(editingPiece?.stars || 1);
    const [setBonus, setSetBonus] = useState<GearSetName>(editingPiece?.setBonus || 'FORTITUDE');
    const [level, setLevel] = useState<number>(editingPiece?.level || 0);

    useEffect(() => {
        if (editingPiece) {
            setSlot(editingPiece.slot);
            setMainStat(editingPiece.mainStat);
            setSubStats(editingPiece.subStats);
            setRarity(editingPiece.rarity);
            setStars(editingPiece.stars);
            setSetBonus(editingPiece.setBonus);
            setLevel(editingPiece.level);
        }
    }, [editingPiece]);

    // Get available main stats based on slot
    const getAvailableMainStats = (slot: GearSlotName): StatName[] => {
        switch (slot) {
            case 'weapon':
                return ['attack'];
            case 'hull':
                return ['hp'];
            case 'generator':
                return ['defence'];
            case 'sensor':
                return ['hp', 'attack', 'defence', 'crit', 'critDamage',]
            case 'software':
                return ['hp', 'attack', 'defence', 'hacking', 'speed'];
            case 'thrusters':
                return ['hp', 'attack', 'defence'];
            default:
                return [];
        }
    };

    // Add this helper function
    const getAvailableStatTypes = (statName: StatName): StatType[] => {
        if (['crit', 'critDamage', 'healModifier'].includes(statName)) {
            return ['percentage'];
        }
        if (['speed', 'hacking', 'security'].includes(statName)) {
            return ['flat'];
        }
        return ['flat', 'percentage'];
    };

    // Update main stat when slot changes
    useEffect(() => {
        const availableStats = getAvailableMainStats(slot);
        setMainStat({ name: availableStats[0], value: 0, type: 'flat' } as Stat);
    }, [slot]);

    const handleAddSubStat = () => {
        if (subStats.length < 4) {
            setSubStats([...subStats, { name: 'hp', value: 0, type: 'flat' }]);
        }
    };

    const handleSubStatChange = (index: number, newStat: Partial<Pick<Stat, 'value' | 'name'>> & { type?: StatType }) => {
        const newSubStats = [...subStats];
        const currentStat = subStats[index];

        // Determine correct type based on stat name
        let type: StatType = currentStat.type;
        console.log(newStat);
        if (newStat.name) {
            if (['crit', 'critDamage', 'healModifier'].includes(newStat.name)) type = 'percentage';
            if (['speed', 'hacking', 'security'].includes(newStat.name)) type = 'flat';
        }

        if (newStat.type === 'percentage') {
            if (newStat.value && newStat.value > 50) newStat.value = 50; // Cap percentage stats at 50
        } else if (newStat.type === 'flat') {
            if (newStat.value && newStat.value > 5000) newStat.value = 5000; // Cap flat stats at 5000
        }

        newSubStats[index] = {
            ...currentStat,
            ...newStat,
            type: newStat.type || type
        } as Stat;

        setSubStats(newSubStats);
    };

    const handleMainStatChange = (changes: Partial<Pick<Stat, 'value' | 'name'>> & { type?: StatType }) => {
        let type: StatType = mainStat.type;

        if (mainStat.type === 'percentage' || changes.type === 'percentage') {
            if (changes.value && changes.value > 50) changes.value = 50;
        }

        setMainStat({
            ...mainStat,
            ...changes,
            type: changes.type || type
        } as Stat);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const piece: GearPiece = {
            id: editingPiece?.id || Date.now().toString(),
            slot,
            mainStat,
            subStats,
            setBonus: setBonus,
            stars,
            rarity,
            level
        };
        onSubmit(piece);
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
        label: set.name
    }));

    const rarityOptions = Object.entries(RARITIES).map(([key, rarity]) => ({
        value: key,
        label: rarity.label
    }));

    const gearTypeOptions = Object.entries(GEAR_SLOTS).map(([key, slot]) => ({
        value: key,
        label: slot.label
    }));

    return (
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg bg-dark p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Select
                    label="Set Bonus"
                    value={setBonus}
                    onChange={(e) => setSetBonus(e.target.value as GearSetName)}
                    options={setOptions}
                />

                <Select
                    label="Slot"
                    value={slot}
                    onChange={(e) => setSlot(e.target.value as GearSlotName)}
                    options={gearTypeOptions}
                />

                <Select
                    label="Stars"
                    value={stars.toString()}
                    onChange={(e) => setStars(Number(e.target.value))}
                    options={[1, 2, 3, 4, 5, 6].map(num => ({
                        value: num.toString(),
                        label: `${num} ⭐`
                    }))}
                />

                <Input
                    type="number"
                    label="Level"
                    value={level}
                    max={16}
                    onChange={(e) => setLevel(Number(e.target.value))}
                />

                <Select
                    label="Rarity"
                    value={rarity}
                    onChange={(e) => setRarity(e.target.value as RarityName)}
                    options={rarityOptions}
                />

                {/* Main Stat Section */}
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label="Main Stat"
                        value={mainStat.name}
                        onChange={(e) => handleMainStatChange({ name: e.target.value as StatName })}
                        options={getAvailableMainStats(slot).map(stat => ({
                            value: stat,
                            label: stat
                        }))}
                    />
                    <Input
                        label="Main Stat Value"
                        type="number"
                        max={mainStat.type === 'percentage' ? 50 : 5000}
                        value={mainStat.value}
                        onChange={(e) => handleMainStatChange({ value: Number(e.target.value) })}
                        className="w-32"
                        labelClassName="invisible"
                    />
                    {(slot === 'sensor' || slot === 'software' || slot === 'thrusters') && (
                        <Select
                            value={mainStat.type}
                            onChange={(e) => handleMainStatChange({ type: e.target.value as StatType })}
                            options={getAvailableStatTypes(mainStat.name).map(type => ({
                                value: type,
                                label: type
                            }))}
                            className="w-32"
                        />
                    )}
                </div>
            </div>

            {/* Sub Stats Section */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h4 className="text-sm font-medium text-gray-200">Sub Stats</h4>
                    {subStats.length < 4 && (
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleAddSubStat}
                        >
                            Add Sub Stat
                        </Button>
                    )}
                </div>
                <div className="space-y-3">
                    {subStats.map((stat, index) => (
                        <div key={index} className="flex gap-4">
                            <Select
                                value={stat.name}
                                onChange={(e) => handleSubStatChange(index, { ...stat, name: e.target.value as StatName })}
                                options={Object.values(['hp', 'attack', 'defence', 'crit', 'critDamage', 'hacking', 'speed']).map(statName => ({
                                    value: statName,
                                    label: statName
                                }))}
                            />
                            <Input
                                type="number"
                                value={stat.value}
                                max={stat.type === 'percentage' ? 50 : 5000}
                                onChange={(e) => handleSubStatChange(index, { ...stat, value: Number(e.target.value) })}
                                className="w-32"
                            />
                            <Select
                                value={stat.type}
                                onChange={(e) => handleSubStatChange(index, { ...stat, type: e.target.value as StatType })}
                                options={getAvailableStatTypes(stat.name).map(type => ({
                                    value: type,
                                    label: type
                                }))}
                                className="w-32"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
                <Button type="submit">
                    {editingPiece ? 'Save Gear Piece' : 'Add Gear Piece'}
                </Button>
            </div>
        </form>
    );
};