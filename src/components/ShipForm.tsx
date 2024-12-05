import React, { useState, useEffect, useMemo } from 'react';
import { Ship, BaseStats } from '../types/ship';
import { Button, Input, Select } from './ui';
import { FACTIONS, RARITIES, SHIP_TYPES, RarityName } from '../constants';
import { useInventory } from '../hooks/useInventory';
import { calculateTotalStats } from '../utils/statsCalculator';
import { fetchShipData } from '../utils/shipDataFetcher';

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
    const [rarity, setRarity] = useState(editingShip?.rarity || 'common');
    const { getGearPiece } = useInventory();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (editingShip) {
            setName(editingShip.name);
            setBaseStats(editingShip.baseStats);
            setFaction(editingShip.faction);
            setType(editingShip.type);
            setRarity(editingShip.rarity);
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
            rarity,
            baseStats,
            stats: totalStats,
            equipment: editingShip?.equipment || {}
        };
        onSubmit(ship);

        setName('');
        setBaseStats(initialBaseStats);
        setFaction(FACTIONS['ATLAS'].name);
        setType(SHIP_TYPES['ATTACKER'].name);
        setRarity('legendary');
    };

    const handleFetchData = async () => {
        if (!name) return;

        setIsLoading(true);
        setError(null);

        try {
            const data = await fetchShipData(name);
            if (!data) {
                setError('Could not find ship data. Please check the ship name and try again.');
                return;
            }

            setBaseStats(data.baseStats);
            setFaction(data.faction);
            setType(data.type);
            setRarity(data.rarity as RarityName);
        } catch (err) {
            setError('Failed to fetch ship data. Please try again later.');
            console.error('Error fetching ship data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const shipTypeOptions = Object.entries(SHIP_TYPES).map(([key, type]) => ({
        value: key,
        label: type.name
    }));

    const factionOptions = Object.entries(FACTIONS).map(([key, faction]) => ({
        value: key,
        label: faction.name
    }));

    const rarityOptions = Object.entries(RARITIES).map(([key, rarity]) => ({
        value: rarity.value,
        label: rarity.label
    }));

    return (
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg bg-dark p-6">
            <h2 className="text-2xl font-bold text-gray-200">
                {editingShip ? 'Edit Ship' : 'Create New Ship'}
            </h2>

            {/* Ship Name with Fetch button */}
            <div className="space-y-2">
                <div className="flex gap-4">
                    <div className="flex-1">
                        <Input
                            label="Ship Name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setError(null); // Clear error when input changes
                            }}
                            required
                            placeholder="Enter ship name"
                            error={error ? ' ' : ''}
                        />
                    </div>
                    <div className="flex items-end">
                        <Button
                            variant="primary"
                            onClick={handleFetchData}
                            disabled={!name || isLoading}
                            className="relative"
                        >
                            {isLoading ? (
                                <>
                                    <span className="opacity-0">Fetch Data</span>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    </div>
                                </>
                            ) : (
                                'Fetch Data'
                            )}
                        </Button>
                    </div>
                </div>

                {/* Error message */}
                {error && (
                    <div className="text-red-500 text-sm mt-1">
                        {error}
                    </div>
                )}
            </div>

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

            {/* Rarity */}
            <Select
                label="Rarity"
                value={rarity}
                onChange={(e) => setRarity(e.target.value as RarityName)}
                required
                options={rarityOptions}
            />

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