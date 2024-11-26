import React, { useState, useEffect } from 'react';
import { GearPiece, Stat, GearSlot, StatName, Rarity, StatType } from '../types/gear';
import { GearSetName } from '../constants/gearSets';
import { GEAR_SETS } from '../constants/gearSets';

interface Props {
    onSubmit: (piece: GearPiece) => void;
    editingPiece?: GearPiece;
}

export const GearPieceForm: React.FC<Props> = ({ onSubmit, editingPiece }) => {
    const [slot, setSlot] = useState<GearSlot>(editingPiece?.slot || 'weapon');
    const [mainStat, setMainStat] = useState<Stat>(editingPiece?.mainStat || { name: 'attack', value: 0, type: 'flat' } as Stat);
    const [subStats, setSubStats] = useState<Stat[]>(editingPiece?.subStats || []);
    const [rarity, setRarity] = useState<Rarity>(editingPiece?.rarity || 'rare');
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
    const getAvailableMainStats = (slot: GearSlot): StatName[] => {
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
        if (newStat.name) {
            if (['crit', 'critDamage', 'healModifier'].includes(newStat.name)) type = 'percentage';
            if (['speed', 'hacking', 'security'].includes(newStat.name)) type = 'flat';
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
        if (changes.name) {
            if (['crit'].includes(changes.name) && changes.value && changes.value > 100) changes.value = 100;
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
            setBonus,
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

    return (
        <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-lg shadow-md p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Set Bonus Section */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Set Bonus
                    </label>
                    <select
                        value={setBonus}
                        onChange={(e) => setSetBonus(e.target.value as GearSetName)}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        {setOptions.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Slot and Rarity in first row */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Slot
                    </label>
                    <select 
                        value={slot} 
                        onChange={(e) => setSlot(e.target.value as GearSlot)}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="weapon">Weapon</option>
                        <option value="hull">Hull</option>
                        <option value="generator">Generator</option>
                        <option value="sensor">Sensor</option>
                        <option value="software">Software</option>
                        <option value="thrusters">Thrusters</option>
                    </select>
                </div>

                {/* Stars Section */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Stars
                    </label>
                    <select 
                        value={stars} 
                        onChange={(e) => setStars(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        {[1, 2, 3, 4, 5, 6].map(num => (
                            <option key={num} value={num}>{num} ⭐</option>
                        ))}
                    </select>
                </div>

                {/* Level Section */}
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Level
                    </label>
                    <input
                        type="number"
                        value={level}
                        max={16}
                        onChange={(e) => setLevel(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>


                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                        Rarity
                    </label>
                    <select 
                        value={rarity} 
                        onChange={(e) => setRarity(e.target.value as Rarity)}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="rare" className="text-blue-600">Rare</option>
                        <option value="epic" className="text-purple-600">Epic</option>
                        <option value="legendary" className="text-yellow-600">Legendary</option>
                    </select>
                </div>
            </div>

            {/* Main Stat Section */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                    Main Stat
                </label>
                <div className="flex gap-4">
                    <select 
                        value={mainStat.name}
                        onChange={(e) => handleMainStatChange({ name: e.target.value as StatName })}
                        className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        {getAvailableMainStats(slot).map(stat => (
                            <option key={stat} value={stat}>{stat}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        value={mainStat.value}
                        onChange={(e) => handleMainStatChange({ value: Number(e.target.value) })}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {(slot === 'sensor' || slot === 'software' || slot === 'thrusters') && (
                        <select
                            value={mainStat.type}
                            onChange={(e) => handleMainStatChange({ type: e.target.value as StatType })}
                            className="w-32 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            {['crit', 'critDamage'].includes(mainStat.name) ? (
                                <option value="percentage">Percentage</option>
                            ) : ['speed', 'hacking', 'security'].includes(mainStat.name) ? (
                                <option value="flat">Flat</option>
                            ) : (
                                <>
                                    <option value="flat">Flat</option>
                                    <option value="percentage">Percentage</option>
                                </>
                            )}
                        </select>
                    )}
                </div>
            </div>

            {/* Sub Stats Section */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h4 className="text-sm font-medium text-gray-700">Sub Stats</h4>
                    {subStats.length < 4 && (
                        <button 
                            type="button" 
                            onClick={handleAddSubStat}
                            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                            Add Sub Stat
                        </button>
                    )}
                </div>
                <div className="space-y-3">
                    {subStats.map((stat, index) => (
                        <div key={index} className="flex gap-4">
                            <select
                                value={stat.name}
                                onChange={(e) => handleSubStatChange(index, { ...stat, name: e.target.value as StatName })}
                                className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {Object.values(['hp', 'attack', 'defence', 'crit', 'critDamage', 'hacking', 'speed']).map(statName => (
                                    <option key={statName} value={statName}>{statName}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                value={stat.value}
                                onChange={(e) => handleSubStatChange(index, { ...stat, value: Number(e.target.value) })}
                                className="w-32 px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <select
                                value={stat.type}
                                onChange={(e) => handleSubStatChange(index, { ...stat, type: e.target.value as StatType })}
                                className="w-32 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                {getAvailableStatTypes(stat.name).map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
                <button 
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                    {editingPiece ? 'Save Gear Piece' : 'Add Gear Piece'}
                </button>
            </div>
        </form>
    );
};