import React, { useState, useEffect } from 'react';
import { Ship } from '../../types/ship';
import { BaseStats, StatName } from '../../types/stats';
import { Button, Input, Select, CloseIcon } from '../ui';
import {
    FACTIONS,
    RARITIES,
    SHIP_TYPES,
    RarityName,
    STATS,
    ShipTypeName,
    FactionName,
} from '../../constants';
import { fetchShipData } from '../../utils/dataUpdate/shipDataFetcher';
import { StatModifierInput } from '../stats/StatModifierInput';
import { useNotification } from '../../hooks/useNotification';
import { AffinityName } from '../../types/ship';

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

const AFFINITIES: { value: AffinityName; label: string }[] = [
    { value: 'chemical', label: 'Chemical' },
    { value: 'electric', label: 'Electric' },
    { value: 'thermal', label: 'Thermal' },
    { value: 'antimatter', label: 'Antimatter' },
];

export const ShipForm: React.FC<Props> = ({ onSubmit, editingShip }) => {
    const [name, setName] = useState(editingShip?.name || '');
    const [baseStats, setBaseStats] = useState<BaseStats>(
        editingShip?.baseStats || initialBaseStats
    );
    const [faction, setFaction] = useState(editingShip?.faction || '');
    const [type, setType] = useState(editingShip?.type || '');
    const [rarity, setRarity] = useState(editingShip?.rarity || '');
    const [refits, setRefits] = useState(editingShip?.refits || []);
    const [implants, setImplants] = useState(editingShip?.implants || []);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { addNotification } = useNotification();
    const [affinity, setAffinity] = useState<AffinityName | undefined>(editingShip?.affinity);

    useEffect(() => {
        if (editingShip) {
            setName(editingShip.name);
            setBaseStats(editingShip.baseStats);
            setFaction(editingShip.faction);
            setType(editingShip.type);
            setRarity(editingShip.rarity);
            setRefits(editingShip.refits);
            setImplants(editingShip.implants);
            setAffinity(editingShip.affinity);
        }
    }, [editingShip]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const ship: Ship = {
            id: editingShip?.id || Date.now().toString(),
            name,
            faction,
            type,
            rarity,
            affinity,
            baseStats,
            equipment: editingShip?.equipment || {},
            equipmentLocked: editingShip?.equipmentLocked || false,
            refits,
            implants,
        };

        try {
            await onSubmit(ship);
            setName('');
            setBaseStats(initialBaseStats);
            setFaction('');
            setType('');
            setRarity('');
            setRefits([]);
            setImplants([]);
        } catch (error) {
            addNotification('error', 'Failed to save ship data');
            console.error('Error saving ship:', error);
        }
    };

    const handleFetchData = async () => {
        if (!name) return;

        setIsLoading(true);
        setError(null);

        try {
            const data = await fetchShipData(name);
            if (!data) {
                setError(
                    "Could not find ship data. If it's a newer ship, I may not have it in the database yet."
                );
                return;
            }

            setBaseStats(data.baseStats);
            setFaction(data.faction);
            setType(data.type);
            setRarity(data.rarity as RarityName);
            setAffinity(data.affinity as AffinityName);
            addNotification('success', 'Ship data fetched successfully');
        } catch (err) {
            setError(
                "Failed to fetch ship data. If it's a newer ship, I may not have it in the database yet."
            );
            console.error('Error fetching ship data:', err);
            addNotification(
                'error',
                "Failed to fetch ship data. If it's a newer ship, I may not have it in the database yet."
            );
        } finally {
            setIsLoading(false);
        }
    };

    const shipTypeOptions = Object.entries(SHIP_TYPES).map(([key, type]) => ({
        value: key,
        label: type.name,
    }));

    const factionOptions = Object.entries(FACTIONS).map(([key, faction]) => ({
        value: key,
        label: faction.name,
    }));

    const rarityOptions = Object.entries(RARITIES).map(([_, rarity]) => ({
        value: rarity.value,
        label: rarity.label,
    }));

    const handleImplantDelete = (index: number) => {
        if (window.confirm('Are you sure you want to remove this implant?')) {
            setImplants(implants.filter((_, i) => i !== index));
        }
    };

    const handleRefitDelete = (index: number) => {
        if (window.confirm('Are you sure you want to remove this refit?')) {
            setRefits(refits.filter((_, i) => i !== index));
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6  bg-dark p-6">
            <h2 className="text-2xl font-bold ">{editingShip ? 'Edit Ship' : 'Create New Ship'}</h2>

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
                            aria-label="Fetch ship data"
                            type="button"
                            variant="primary"
                            onClick={(e) => {
                                e.preventDefault();
                                handleFetchData();
                            }}
                            disabled={!name || isLoading}
                            className="relative"
                        >
                            {isLoading ? (
                                <>
                                    <span className="opacity-0">Fetch Data</span>
                                    <div
                                        className="absolute inset-0 flex items-center justify-center"
                                        role="status"
                                    >
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
                {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
            </div>

            {/* Type and Faction section */}
            <div className="flex flex-row flex-wrap gap-4">
                <Select
                    label="Faction"
                    value={faction}
                    onChange={(value) => setFaction(value as FactionName)}
                    options={factionOptions}
                    noDefaultSelection
                    defaultOption="Select Faction"
                />

                <Select
                    label="Type"
                    value={type}
                    onChange={(value) => setType(value as ShipTypeName)}
                    options={shipTypeOptions}
                    noDefaultSelection
                    defaultOption="Select Type"
                />

                <Select
                    label="Affinity"
                    value={affinity || ''}
                    onChange={(value) => setAffinity(value as AffinityName)}
                    options={AFFINITIES}
                    noDefaultSelection
                    defaultOption="Select Affinity"
                />
            </div>

            {/* Rarity */}
            <Select
                label="Rarity"
                value={rarity}
                onChange={(value) => setRarity(value as RarityName)}
                options={rarityOptions}
                noDefaultSelection
                defaultOption="Select Rarity"
            />

            {/* Base Stats */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium ">Base Stats</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(baseStats).map(
                        ([stat, value]) =>
                            stat !== 'healModifier' && (
                                <Input
                                    key={stat}
                                    type="number"
                                    label={STATS[stat as StatName].label}
                                    value={value}
                                    onChange={(e) =>
                                        setBaseStats((prev) => ({
                                            ...prev,
                                            [stat]: Number(e.target.value),
                                        }))
                                    }
                                    min="0"
                                />
                            )
                    )}
                </div>
            </div>

            {/* Refits Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium ">Refits</h3>
                {refits?.map((refit, index) => (
                    <div key={index} className="p-4 border border-gray-700 relative">
                        <div className="absolute top-4 right-4">
                            <Button
                                aria-label="Delete refit"
                                variant="danger"
                                size="sm"
                                onClick={() => handleRefitDelete(index)}
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                        <StatModifierInput
                            stats={refit.stats}
                            onChange={(newStats) => {
                                const newRefits = [...refits];
                                newRefits[index] = { ...refit, stats: newStats };
                                setRefits(newRefits);
                            }}
                            maxStats={2}
                            defaultExpanded={editingShip ? false : true}
                        />
                    </div>
                ))}
                {refits?.length < 6 && (
                    <Button
                        aria-label="Add refit"
                        type="button"
                        variant="primary"
                        onClick={() => setRefits([...refits, { stats: [] }])}
                    >
                        Add Refit
                    </Button>
                )}
            </div>

            {/* Implants Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium ">Implants</h3>
                {implants?.map((implant, index) => (
                    <div key={index} className="p-4 border border-gray-700 relative">
                        <div className="absolute top-4 right-4">
                            <Button
                                aria-label="Delete implant"
                                variant="danger"
                                size="sm"
                                onClick={() => handleImplantDelete(index)}
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                        <StatModifierInput
                            stats={implant.stats}
                            onChange={(newStats) => {
                                const newImplants = [...implants];
                                newImplants[index] = { ...implant, stats: newStats };
                                setImplants(newImplants);
                            }}
                            maxStats={2}
                            defaultExpanded={editingShip ? false : true}
                        />
                    </div>
                ))}
                {implants?.length < 5 && (
                    <Button
                        aria-label="Add implant"
                        type="button"
                        variant="primary"
                        onClick={() => setImplants([...implants, { stats: [] }])}
                    >
                        Add Implant
                    </Button>
                )}
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
                <Button aria-label={editingShip ? 'Save Changes' : 'Create Ship'} type="submit">
                    {editingShip ? 'Save Changes' : 'Create Ship'}
                </Button>
            </div>
        </form>
    );
};
