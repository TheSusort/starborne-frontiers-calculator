import React, { useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../hooks/useInventory';
import { ShipCard } from './ShipCard';
import { FactionName, FACTIONS, GearSlotName } from '../../constants';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedFaction, setSelectedFaction] = useState<FactionName | ''>('');

    const filteredInventory = useMemo(() => {
        return ships.filter(ship => {
            const matchesFaction = !selectedFaction || ship.faction === selectedFaction;
            return matchesFaction;
        });
    }, [ships, selectedFaction]);

    const uniqueFactions = useMemo(() => {
        const factions = new Set(ships.map(ship => ship.faction));
        return Array.from(factions);
    }, [ships]);

    const { getGearPiece } = useInventory();

    const hasActiveFilters = Boolean(selectedFaction);

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Faction',
            value: selectedFaction,
            onChange: (value) => setSelectedFaction(value as FactionName),
            options: uniqueFactions.map(faction => ({
                value: faction,
                label: FACTIONS[faction].name
            }))
        }
    ];

    const clearFilters = () => {
        setSelectedFaction('');
    };

    return (
        <div className="space-y-6">
            <FilterPanel
                filters={filters}
                isOpen={isFilterOpen}
                onToggle={() => setIsFilterOpen(!isFilterOpen)}
                onClear={clearFilters}
                hasActiveFilters={hasActiveFilters}
            />

            {filteredInventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter  border-2 border-dashed">
                    {ships.length === 0 ? 'No ships created yet' : 'No matching ships found'}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredInventory.map(ship => (
                        <ShipCard
                            key={ship.id}
                            ship={ship}
                            hoveredGear={hoveredGear}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onEdit={onEdit}
                            onRemove={onRemove}
                            onEquipGear={onEquipGear}
                            onRemoveGear={onRemoveGear}
                            onHoverGear={setHoveredGear}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};