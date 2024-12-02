import React, { useState, useEffect, useMemo } from 'react';
import { Ship, BaseStats } from '../types/ship';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { FACTIONS } from '../constants/factions';
import { SHIP_TYPES } from '../constants/shipTypes';
import { Select } from './ui/Select';
import { useInventory } from '../hooks/useInventory';
import { calculateTotalStats } from '../utils/statsCalculator';
interface Props {
    onSubmit: (ship: Ship) => void;
    editingShip?: Ship;
}

const initialBaseStats: BaseStats = {
    hp: 0,
    attack: 0,
    defence: 0,
    hacking: 0,
    security: 0,
    crit: 0,
    critDamage: 0,
    speed: 0,
    healModifier: 0,
};

export const ShipForm: React.FC<Props> = ({ onSubmit, editingShip }) => {
    const [name, setName] = useState(editingShip?.name || '');
    const [baseStats, setBaseStats] = useState<BaseStats>(editingShip?.baseStats || initialBaseStats);
    const [faction, setFaction] = useState(editingShip?.faction || FACTIONS['ATLAS'].name);
    const [type, setType] = useState(editingShip?.type || SHIP_TYPES.ATTACKER.name);
    const { getGearPiece } = useInventory();

    useEffect(() => {
        if (editingShip) {
            setName(editingShip.name);
            setBaseStats(editingShip.baseStats);
            setFaction(editingShip.faction);
            setType(editingShip.type);
        }
    }, [editingShip]);

    const totalStats = useMemo(() => calculateTotalStats(baseStats, editingShip?.equipment || {}, getGearPiece), [baseStats, editingShip?.equipment, getGearPiece]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const ship: Ship = {
            id: editingShip?.id || Date.now().toString(),
            name,
            faction,
            type,
            baseStats,
            stats: totalStats,
            equipment: editingShip?.equipment || {}
        };
        onSubmit(ship);

        setName('');
        setBaseStats(initialBaseStats);
        setFaction(FACTIONS['ATLAS'].name);
        setType(SHIP_TYPES['ATTACKER'].name);
    };

    const shipTypeOptions = Object.entries(SHIP_TYPES).map(([key, type]) => ({
        value: key,
        label: type.name
    }));

    const factionOptions = Object.entries(FACTIONS).map(([key, faction]) => ({
        value: key,
        label: faction.name
    }));

    return (
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg bg-dark p-6">
            <h2 className="text-2xl font-bold text-gray-200">
                {editingShip ? 'Edit Ship' : 'Create New Ship'}
            </h2>
            
            {/* Ship Name */}
            <Input
                label="Ship Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Enter ship name"
            />

            {/* Type and Faction section */}
            <div className="flex flex-row gap-4">
                <Select
                    label="Faction"
                    value={faction}
                    onChange={(e) => setFaction(e.target.value)}
                    required
                    options={factionOptions}
                />

                <Select
                    label="Type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    required
                    options={shipTypeOptions}
                />
            </div>

            {/* Base Stats */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-200">Base Stats</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(baseStats).map(([stat, value]) => (
                        stat !== 'healModifier' && (
                            <Input
                                key={stat}
                                type="number"
                                label={stat.charAt(0).toUpperCase() + stat.slice(1)}
                                value={value}
                                onChange={(e) => setBaseStats(prev => ({
                                    ...prev,
                                    [stat]: Number(e.target.value)
                                }))}
                                min="0"
                            />
                        )
                    ))}
                </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
                <Button type="submit">
                    {editingShip ? 'Save Changes' : 'Create Ship'}
                </Button>
            </div>
        </form>
    );
}; 