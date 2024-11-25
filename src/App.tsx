import React, { useState, useEffect } from 'react';
import { GearPieceForm } from './components/GearPieceForm';
import { GearInventory } from './components/GearInventory';
import { GearPiece, GearSlot, StatName, Stat } from './types/gear';
import { Ship, BaseStats } from './types/ship';
import { ShipForm } from './components/ShipForm';
import { ShipInventory } from './components/ShipInventory';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const App: React.FC = () => {
    const [inventory, setInventory] = useState<GearPiece[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [ships, setShips] = useState<Ship[]>([]);

    useEffect(() => {
        loadInventory();
    }, []);

    const loadInventory = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`${API_URL}/inventory`);
            if (!response.ok) throw new Error('Failed to load inventory');
            const data = await response.json();
            setInventory(data);
        } catch (error) {
            console.error('Error loading inventory:', error);
            setError('Failed to load inventory. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    const saveInventory = async (newInventory: GearPiece[]) => {
        try {
            setError(null);
            const response = await fetch(`${API_URL}/inventory`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newInventory),
            });
            if (!response.ok) throw new Error('Failed to save inventory');
        } catch (error) {
            console.error('Error saving inventory:', error);
            setError('Failed to save inventory. Please try again later.');
        }
    };

    const handleAddPiece = async (piece: GearPiece) => {
        const newInventory = [...inventory, piece];
        setInventory(newInventory);
        await saveInventory(newInventory);
    };

    const handleRemovePiece = async (id: string) => {
        const newInventory = inventory.filter(piece => piece.id !== id);
        setInventory(newInventory);
        await saveInventory(newInventory);
    };

    const handleAddShip = (ship: Ship) => {
        setShips(prev => [...prev, ship]);
    };

    const handleRemoveShip = (id: string) => {
        setShips(prev => prev.filter(ship => ship.id !== id));
    };

    const handleEquipGear = (shipId: string, slot: GearSlot, gear: GearPiece) => {
        setShips(prev => prev.map(ship => {
            if (ship.id === shipId) {
                const newEquipment = { ...ship.equipment, [slot]: gear };
                
                const totalStats = calculateTotalStats(ship.baseStats, newEquipment);
                
                return {
                    ...ship,
                    equipment: newEquipment,
                    stats: totalStats
                };
            }
            return ship;
        }));
    };

    const calculateTotalStats = (baseStats: BaseStats, equipment: Partial<Record<GearSlot, GearPiece>>): BaseStats => {
        // Start with base stats
        const totalStats = { ...baseStats };
        const percentageModifiers: Partial<Record<StatName, number>> = {};

        // Process all equipped gear
        Object.values(equipment).forEach(gear => {
            if (!gear) return;

            // Process main stat
            addStatModifier(gear.mainStat);
            
            // Process sub stats
            gear.subStats.forEach(addStatModifier);
        });

        // Apply percentage modifiers after all flat values
        Object.entries(percentageModifiers).forEach(([statName, percentage]) => {
            const stat = statName as StatName;
            totalStats[stat] *= (1 + percentage / 100);
            // Round to prevent floating point issues
            totalStats[stat] = Math.round(totalStats[stat] * 100) / 100;
        });

        return totalStats;

        // Helper function to process each stat
        function addStatModifier(stat: Stat) {
            if (stat.type === 'flat') {
                totalStats[stat.name] = (totalStats[stat.name] || 0) + stat.value;
            } else { // percentage
                percentageModifiers[stat.name] = (percentageModifiers[stat.name] || 0) + stat.value;
            }
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="animate-pulse text-xl text-gray-600">
                    Loading inventory...
                </div>
            </div>
        );
    }
    return (
        <div className="min-h-screen bg-gray-100 py-8 px-4">
            <div className="max-w-7xl mx-auto space-y-8">
                <h1 className="text-4xl font-bold text-center text-gray-800 mb-8">
                    Starborne Frontiers Gear Calculator
                </h1>
                
                {error && (
                    <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <ShipForm onSubmit={handleAddShip} />
                    <GearPieceForm onSubmit={handleAddPiece} />
                </div>

                <div className="space-y-8">
                    <ShipInventory 
                        ships={ships}
                        onRemove={handleRemoveShip}
                        onEquipGear={handleEquipGear}
                        availableGear={inventory}
                    />
                    <GearInventory inventory={inventory} onRemove={handleRemovePiece} />
                </div>
            </div>
        </div>
    );
};

export default App;

